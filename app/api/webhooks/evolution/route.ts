import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { orchestrateAiMessage } from '@/lib/ai/orchestrator';

function maskId(val: string | null | undefined): string {
  if (!val) return 'N/A';
  if (val.length <= 8) return '****';
  return `${val.substring(0, 4)}...${val.substring(val.length - 4)}`;
}

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Validar autenticação: chave da Evolution API recebida nos cabeçalhos
    const apiKeyHeader = (
      req.headers.get('apikey') ||
      req.headers.get('x-api-key') ||
      (req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')?.substring(7).trim() : null) ||
      ''
    ).trim();

    if (!apiKeyHeader) {
      return NextResponse.json(
        { error: 'Não autorizado: apikey ausente.' },
        { status: 401 }
      );
    }

    const payload = await req.json().catch(() => ({}));

    // Valida estrutura da mensagem vinda da Evolution API
    const event = payload.event;
    const instance = payload.instance;
    const data = payload.data;

    // 2. Anti-loop rigoroso: ignora mensagens enviadas pelo próprio bot/atendente
    if (data?.key?.fromMe) {
      console.log(`[Webhook Evolution] [anti-loop] Mensagem do próprio bot ignorada | Instância: "${instance || 'desconhecida'}"`);
      return NextResponse.json({ status: 'ignored_from_me' });
    }

    const remoteJid = data?.key?.remoteJid || '';
    const messageText = data?.message?.conversation || data?.message?.extendedTextMessage?.text || '';
    const messageId = data?.key?.id || `${remoteJid}_${Date.now()}`;
    const pushName = data?.pushName || undefined;

    if (!remoteJid || !messageText) {
      return NextResponse.json({ status: 'no_message_content' });
    }

    if (!instance || typeof instance !== 'string') {
      return NextResponse.json({ error: 'Identificador da instância ausente.' }, { status: 400 });
    }

    console.log(
      `[Webhook Evolution] [recebido] Instância: "${instance.trim()}" | Evento: ${event || 'MESSAGES_UPSERT'} | Msg ID: ${maskId(messageId)}`
    );

    // 3. Localiza a loja EXCLUSIVAMENTE pela instância da Evolution API (SEM FALLBACK)
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('id, evolution_api_key, status, ai_recovery_enabled')
      .eq('evolution_instance_name', instance.trim())
      .maybeSingle();

    if (!store) {
      console.warn(`[Webhook Evolution] [loja_nao_encontrada] Nenhuma loja vinculada à instância: "${instance.trim()}"`);
      return NextResponse.json(
        { error: 'Loja não encontrada para a instância informada.' },
        { status: 401 }
      );
    }

    // Validação da apikey esperada para a loja
    const expectedApiKey = (store.evolution_api_key || process.env.EVOLUTION_API_KEY || '').trim();
    if (!expectedApiKey || apiKeyHeader !== expectedApiKey) {
      console.warn(`[Webhook Evolution] [auth_invalida] Falha de autenticação para Store ID: ${maskId(store.id)}`);
      return NextResponse.json(
        { error: 'Chave de autenticação da Evolution API inválida.' },
        { status: 401 }
      );
    }

    if (store.status && store.status !== 'ativa') {
      console.log(`[Webhook Evolution] [loja_inativa] Store ID: ${maskId(store.id)} está inativa. Mensagem ignorada.`);
      return NextResponse.json({ error: 'Loja inativa. Mensagem ignorada.' }, { status: 403 });
    }

    if (!store.ai_recovery_enabled) {
      console.log(`[Webhook Evolution] [ia_desativada] Store ID: ${maskId(store.id)} com IA desativada.`);
      return NextResponse.json({ status: 'ai_recovery_disabled_for_store' });
    }

    console.log(`[Webhook Evolution] [tenant_ok] Instância: "${instance.trim()}" -> Store ID: ${maskId(store.id)}`);

    // 4. Delega para o Orquestrador Central de IA com debounce persistente e tools isoladas
    const orchestratorResult = await orchestrateAiMessage({
      storeId: store.id,
      remoteJid,
      messageId,
      messageText,
      fromMe: false,
      customerName: pushName,
      instanceName: instance.trim(),
    });

    console.log(
      `[Webhook Evolution] [processado] Store ID: ${maskId(store.id)} | Msg ID: ${maskId(messageId)} | Status: ${orchestratorResult.status} | Intenção: ${orchestratorResult.intent || 'N/A'}`
    );

    return NextResponse.json({
      success: orchestratorResult.status !== 'error',
      ...orchestratorResult,
    });
  } catch (err: any) {
    console.error('[Webhook Evolution] [erro_interno] Falha no processamento:', err.message || 'Erro não identificado');
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}

