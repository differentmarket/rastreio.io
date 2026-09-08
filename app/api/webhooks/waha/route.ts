import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { orchestrateAiMessage } from '@/lib/ai/orchestrator';
import { wahaAdapter } from '@/lib/whatsapp/adapters/wahaAdapter';

function maskId(val: string | null | undefined): string {
  if (!val) return 'N/A';
  if (val.length <= 8) return '****';
  return `${val.substring(0, 4)}...${val.substring(val.length - 4)}`;
}

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Extração do cabeçalho de autenticação enviado pelo WAHA
    const apiKeyHeader = (
      req.headers.get('x-api-key') ||
      req.headers.get('apikey') ||
      (req.headers.get('authorization')?.startsWith('Bearer ')
        ? req.headers.get('authorization')?.substring(7).trim()
        : null) ||
      ''
    ).trim();

    const payload = await req.json().catch(() => ({}));

    // 2. Normalização do payload via WahaAdapter
    const normalized = wahaAdapter.normalizePayload(payload);

    if (normalized.isFromMe) {
      console.log(
        `[Webhook WAHA] [anti-loop] Mensagem do próprio bot ignorada | Sessão: "${normalized.instanceName || 'desconhecida'}"`
      );
      return NextResponse.json({ status: 'ignored_from_me' });
    }

    if (!normalized.hasMessageContent || !normalized.message) {
      return NextResponse.json({
        status: 'no_message_content',
        reason: normalized.reason,
      });
    }

    const session = normalized.instanceName || 'default';
    const message = normalized.message;

    console.log(
      `[Webhook WAHA] [recebido] Sessão: "${session}" | Msg ID: ${maskId(message.messageId)}`
    );

    // 3. Localização da Loja via whatsapp_connections
    const { data: connection, error: connErr } = await supabaseAdmin
      .from('whatsapp_connections')
      .select('id, store_id, credentials, status, stores(id, status, ai_recovery_enabled)')
      .eq('provider', 'waha')
      .eq('instance_name', session)
      .eq('status', 'active')
      .maybeSingle();

    if (connErr || !connection) {
      console.warn(
        `[Webhook WAHA] [conexao_nao_encontrada] Nenhuma conexão ativa do WAHA para a sessão: "${session}"`
      );
      return NextResponse.json(
        { error: 'Conexão WAHA não localizada ou inativa para esta sessão.' },
        { status: 401 }
      );
    }

    // 4. Validação de autenticação se houver chave configurada na conexão ou ambiente
    const expectedKey = (
      connection.credentials?.api_key ||
      connection.credentials?.token ||
      process.env.WAHA_API_KEY ||
      ''
    ).trim();

    if (expectedKey && apiKeyHeader && apiKeyHeader !== expectedKey) {
      console.warn(
        `[Webhook WAHA] [auth_invalida] Chave de API inválida para Store ID: ${maskId(connection.store_id)}`
      );
      return NextResponse.json(
        { error: 'Chave de autenticação do WAHA inválida.' },
        { status: 401 }
      );
    }

    const store: any = connection.stores;
    if (store?.status && store.status !== 'ativa') {
      console.log(
        `[Webhook WAHA] [loja_inativa] Store ID: ${maskId(connection.store_id)} está inativa. Mensagem ignorada.`
      );
      return NextResponse.json(
        { error: 'Loja inativa. Mensagem ignorada.' },
        { status: 403 }
      );
    }

    if (store && !store.ai_recovery_enabled) {
      console.log(
        `[Webhook WAHA] [ia_desativada] Store ID: ${maskId(connection.store_id)} com IA desativada.`
      );
      return NextResponse.json({ status: 'ai_recovery_disabled_for_store' });
    }

    console.log(
      `[Webhook WAHA] [tenant_ok] Sessão: "${session}" -> Store ID: ${maskId(connection.store_id)}`
    );

    // 5. Invocação do Orquestrador Central (100% Agnóstico de Provedor)
    const orchestratorResult = await orchestrateAiMessage({
      storeId: connection.store_id,
      remoteJid: message.remoteJid,
      messageId: message.messageId,
      messageText: message.messageText,
      fromMe: false,
      customerName: message.pushName,
      instanceName: session,
    });

    console.log(
      `[Webhook WAHA] [processado] Store ID: ${maskId(connection.store_id)} | Msg ID: ${maskId(message.messageId)} | Status: ${orchestratorResult.status} | Intenção: ${orchestratorResult.intent || 'N/A'}`
    );

    return NextResponse.json({
      success: orchestratorResult.status !== 'error',
      ...orchestratorResult,
    });
  } catch (err: any) {
    console.error('[Webhook WAHA] [erro_interno] Falha no processamento:', err.message || 'Erro não identificado');
    return NextResponse.json(
      { error: err.message || 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}
