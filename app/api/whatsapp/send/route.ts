import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTenantAccess } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { store_id, number, text } = body;

    if (!store_id) {
      return NextResponse.json({ error: 'store_id é obrigatório.' }, { status: 400 });
    }

    if (!number || !text) {
      return NextResponse.json({ error: 'Número de telefone e texto da mensagem são obrigatórios.' }, { status: 400 });
    }

    // 1. Autenticação obrigatória e validação de tenant
    const tenant = await validateTenantAccess(req, store_id);
    if (!tenant.authorized) {
      return NextResponse.json({ error: tenant.error || 'Acesso negado a esta loja.' }, { status: tenant.status });
    }

    // 2. Sanitiza número de telefone
    const cleanNumber = number.replace(/\D/g, '');
    const formattedNumber = cleanNumber.length <= 11 && !cleanNumber.startsWith('55') ? `55${cleanNumber}` : cleanNumber;

    // 3. Validação se o número pertence a conversa ou pedido da loja autorizada
    if (!tenant.isSuperAdmin) {
      const { data: matchedConv } = await supabaseAdmin
        .from('ai_recovery_conversations')
        .select('id')
        .eq('store_id', store_id)
        .ilike('customer_phone', `%${cleanNumber.slice(-8)}%`)
        .limit(1)
        .maybeSingle();

      if (!matchedConv) {
        const { data: matchedOrder } = await supabaseAdmin
          .from('orders')
          .select('id')
          .eq('store_id', store_id)
          .ilike('raw_payload::text', `%${cleanNumber.slice(-8)}%`)
          .limit(1)
          .maybeSingle();

        if (!matchedOrder) {
          return NextResponse.json(
            { error: 'Acesso negado. O número informado não pertence a nenhum pedido ou atendimento desta loja.' },
            { status: 403 }
          );
        }
      }
    }

    let apiUrl = process.env.EVOLUTION_API_URL;
    let apiKey = process.env.EVOLUTION_API_KEY;
    let instanceName = process.env.EVOLUTION_INSTANCE_NAME;

    // Busca credenciais específicas da loja autorizada
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('evolution_api_url, evolution_api_key, evolution_instance_name, whatsapp_enabled')
      .eq('id', store_id)
      .maybeSingle();

    if (store && store.evolution_api_url && store.evolution_api_key && store.evolution_instance_name) {
      apiUrl = store.evolution_api_url;
      apiKey = store.evolution_api_key;
      instanceName = store.evolution_instance_name;
    }

    if (!apiUrl || !apiKey || !instanceName) {
      return NextResponse.json(
        { error: 'Credenciais da Evolution API não configuradas para esta loja.' },
        { status: 400 }
      );
    }

    // Envio HTTP POST para a Evolution API
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey,
      },
      body: JSON.stringify({
        number: formattedNumber,
        text,
        delay: 1200,
        linkPreview: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Erro na resposta da Evolution API:', data);
      return NextResponse.json({ error: data.message || 'Falha ao enviar mensagem via Evolution API.' }, { status: response.status });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    console.error('Erro na API de envio do WhatsApp:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
