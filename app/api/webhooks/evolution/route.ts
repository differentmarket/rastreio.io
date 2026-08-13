import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    // Valida estrutura da mensagem vinda da Evolution API
    const event = payload.event;
    const instance = payload.instance;
    const data = payload.data;

    // Filtra apenas mensagens recebidas (de clientes, ignorando mensagens enviadas pelo próprio bot)
    if (data?.key?.fromMe) {
      return NextResponse.json({ status: 'ignored_from_me' });
    }

    const remoteJid = data?.key?.remoteJid || '';
    const messageText = data?.message?.conversation || data?.message?.extendedTextMessage?.text || '';

    if (!remoteJid || !messageText) {
      return NextResponse.json({ status: 'no_message_content' });
    }

    // Extrai número limpo
    const phoneClean = remoteJid.split('@')[0];

    // Localiza a loja pela instância da Evolution API
    let { data: store } = await supabaseAdmin
      .from('stores')
      .select('*')
      .eq('evolution_instance_name', instance)
      .maybeSingle();

    if (!store) {
      // Fallback para a primeira loja ativa caso a instância seja genérica
      const { data: defaultStore } = await supabaseAdmin
        .from('stores')
        .select('*')
        .eq('status', 'ativa')
        .limit(1)
        .maybeSingle();
      store = defaultStore;
    }

    if (!store || !store.ai_recovery_enabled) {
      return NextResponse.json({ status: 'ai_recovery_disabled_for_store' });
    }

    // Busca pedidos recentes associados a este cliente no banco
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('id, nome, email')
      .ilike('telefone', `%${phoneClean.slice(-8)}%`)
      .maybeSingle();

    let orderInfoStr = 'Nenhum pedido recente localizado com este número.';
    let orderId = null;

    if (customer) {
      const { data: order } = await supabaseAdmin
        .from('orders')
        .select('id, numero_pedido, status_pedido, valor_total, created_at, trackings ( codigo_rastreio, status, historico )')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (order) {
        orderId = order.id;
        const tracking = Array.isArray(order.trackings) ? order.trackings[0] : order.trackings;
        orderInfoStr = `
- Número do Pedido: #${order.numero_pedido}
- Status do Pedido: ${order.status_pedido}
- Valor Total: R$ ${order.valor_total}
- Código de Rastreio: ${tracking?.codigo_rastreio || 'Pendente'}
- Status da Entrega: ${tracking?.status || 'Processando'}
- Histórico Logístico: ${JSON.stringify(tracking?.historico || [])}
        `.trim();
      }
    }

    // Mapeamento de tom de voz
    const toneMap: Record<string, string> = {
      amigavel: 'Tom amigável, descontraído e atencioso.',
      vendedor: 'Tom persuasivo e focado em vendas, destacando benefícios do produto e oferecendo cupons de desconto.',
      formal: 'Tom formal, direto, técnico e profissional.',
      empatico: 'Tom empático, calmo e acolhedor para resolver qualquer dúvida com paciência.',
    };

    const selectedToneDesc = toneMap[store.ai_tone || 'amigavel'] || toneMap.amigavel;
    const aiCouponCode = store.ai_coupon_code || '';

    // Substituição de variáveis dinâmicas no prompt do lojista
    let customPromptProcessed = store.ai_prompt_custom || '';
    customPromptProcessed = customPromptProcessed
      .replace(/\{NOME_CLIENTE\}/g, customer?.nome || 'Cliente')
      .replace(/\{NUMERO_PEDIDO\}/g, customer ? 'do seu pedido' : '')
      .replace(/\{CUPOM_DESCONTO\}/g, aiCouponCode ? `Cupom de Desconto: ${aiCouponCode}` : '')
      .replace(/\{LINK_RASTREIO\}/g, `${process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app'}/rastreio`);

    // Prepara o Prompt do Agente de IA para Recuperação de Vendas e Suporte
    const systemPrompt = `
Você é a IA de Atendimento e Recuperação de Vendas oficial da loja "${store.nome_loja}".
Seu objetivo é resolver dúvidas e converter vendas no WhatsApp.

TOM DE VOZ EXIGIDO:
${selectedToneDesc}

DADOS DA LOJA:
- Nome: ${store.nome_loja}
- Suporte WhatsApp: ${store.whatsapp_suporte || 'Atendimento Oficial'}
${aiCouponCode ? `- Cupom Especial de Desconto Disponível: ${aiCouponCode}` : ''}

DADOS DO CLIENTE E PEDIDO LOCALIZADO:
${orderInfoStr}

INSTRUÇÕES ESPECÍFICAS DO LOJISTA:
${customPromptProcessed || 'Ajude o cliente com dúvidas sobre a entrega do produto, informe o código de rastreio e ofereça suporte proativo caso o pedido esteja pendente ou atrasado.'}

REGRAS DE RESPOSTA:
1. Responda em Português do Brasil de forma natural.
2. Seja conciso (máximo 3 a 4 frases por mensagem).
3. Se o cliente pedir o link de rastreio, forneça: ${process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app'}/rastreio/[codigo_rastreio].
4. Se o pedido estiver pendente ou se o cliente hesitar, ofereça ajuda e o cupom de desconto ${aiCouponCode || ''} caso ajude a fechar a compra.
5. Não invente dados fictícios.
    `.trim();

    // Chamada à OpenAI API (ou fallback gracioso)
    const apiKey = store.openai_api_key || process.env.OPENAI_API_KEY;
    const targetModel = store.ai_model || 'gpt-4o-mini';
    const targetTemp = typeof store.ai_temperature === 'number' ? store.ai_temperature : 0.7;

    let aiResponseText = `Olá! Sou o assistente virtual da ${store.nome_loja}. Recebemos sua mensagem sobre o pedido. Como posso ajudar com sua entrega hoje?`;

    if (apiKey) {
      try {
        const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: targetModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: messageText },
            ],
            temperature: targetTemp,
            max_tokens: 350,
          }),
        });

        const openAiData = await openAiRes.json();
        if (openAiData?.choices?.[0]?.message?.content) {
          aiResponseText = openAiData.choices[0].message.content.trim();
        }
      } catch (errAi) {
        console.error('Erro na chamada da OpenAI API:', errAi);
      }
    }

    // Envia a resposta gerada pela IA de volta ao cliente via Evolution API
    const apiUrl = store.evolution_api_url || process.env.EVOLUTION_API_URL;
    const apiSecret = store.evolution_api_key || process.env.EVOLUTION_API_KEY;
    const instName = store.evolution_instance_name || instance;

    if (apiUrl && apiSecret && instName) {
      await fetch(`${apiUrl.replace(/\/$/, '')}/message/sendText/${instName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiSecret,
        },
        body: JSON.stringify({
          number: phoneClean,
          text: aiResponseText,
          delay: 1500,
        }),
      });
    }

    // Registra a conversa na tabela ai_recovery_conversations
    await supabaseAdmin.from('ai_recovery_conversations').insert({
      store_id: store.id,
      order_id: orderId,
      customer_phone: phoneClean,
      customer_name: customer?.nome || null,
      status: 'em_andamento',
      mensagens: [
        { sender: 'customer', text: messageText, timestamp: new Date().toISOString() },
        { sender: 'ai', text: aiResponseText, timestamp: new Date().toISOString() },
      ],
    });

    return NextResponse.json({ success: true, ai_response: aiResponseText });
  } catch (err: any) {
    console.error('Erro no Webhook da Evolution API / Agente de IA:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
