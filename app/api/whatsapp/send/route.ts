import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { store_id, number, text } = body;

    if (!number || !text) {
      return NextResponse.json({ error: 'Número de telefone e texto da mensagem são obrigatórios.' }, { status: 400 });
    }

    let apiUrl = process.env.EVOLUTION_API_URL;
    let apiKey = process.env.EVOLUTION_API_KEY;
    let instanceName = process.env.EVOLUTION_INSTANCE_NAME;

    // Se fornecido store_id, busca credenciais específicas da loja
    if (store_id) {
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
    }

    if (!apiUrl || !apiKey || !instanceName) {
      return NextResponse.json(
        { error: 'Credenciais da Evolution API não configuradas para esta loja.' },
        { status: 400 }
      );
    }

    // Sanitiza número de telefone (remove caracteres não numéricos)
    const cleanNumber = number.replace(/\D/g, '');
    const formattedNumber = cleanNumber.length <= 11 && !cleanNumber.startsWith('55') ? `55${cleanNumber}` : cleanNumber;

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
