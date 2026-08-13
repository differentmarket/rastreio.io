import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  try {
    const { codigo } = await params;
    const body = await req.json().catch(() => ({}));
    const userMessage = body.message || '';

    if (!userMessage.trim()) {
      return NextResponse.json({ error: 'Mensagem inválida.' }, { status: 400 });
    }

    // 1. Buscar dados de rastreio, pedido e loja no Supabase
    const { data: tracking } = await supabaseAdmin
      .from('trackings')
      .select('codigo_rastreio, status, historico, created_at, store_id, orders ( id, numero_pedido, created_at, valor_total, customer_id, store_id )')
      .eq('codigo_rastreio', codigo.toUpperCase().trim())
      .maybeSingle();

    if (!tracking) {
      return NextResponse.json({ error: 'Rastreio não localizado.' }, { status: 404 });
    }

    const orderData: any = tracking.orders;
    let customerName = 'Cliente';
    if (orderData?.customer_id) {
      const { data: cust } = await supabaseAdmin
        .from('customers')
        .select('nome')
        .eq('id', orderData.customer_id)
        .maybeSingle();
      if (cust?.nome) customerName = cust.nome.split(' ')[0];
    }

    // 2. Carregar configurações da loja/sistema
    const { data: dbSettings } = await supabaseAdmin.from('settings').select('key, value');
    const cfg: Record<string, string> = {};
    dbSettings?.forEach(s => { cfg[s.key] = s.value; });

    let openaiKey = cfg['OPENAI_API_KEY'] || process.env.OPENAI_API_KEY || '';
    const empresaNome = cfg['EMPRESA_NOME'] || 'Rastreio.IO';

    // Dados da Taxa se ativa
    const taxaEnabled = cfg['TAXA_ENABLED'] !== 'false';
    const taxaNome = cfg['TAXA_NOME'] || 'Taxa de Despacho Postal e Liberação Alfandegária';
    const taxaValor = cfg['TAXA_VALOR'] || '27.90';

    const historicoFormatado = Array.isArray(tracking.historico)
      ? tracking.historico.map((h: any) => `- ${h.data ? new Date(h.data).toLocaleDateString('pt-BR') : ''}: ${h.descricao || h.status} (${h.local || ''})`).join('\n')
      : 'Em preparação';

    // System Prompt contextualizado com o pedido
    const systemPrompt = `Você é o Assistente Virtual inteligente de Atendimento da loja "${empresaNome}".
Seu objetivo é ajudar o cliente "${customerName}" com dúvidas sobre a entrega do seu pedido #${orderData?.numero_pedido || ''}.

CÓDIGO DE RASTREIO: ${tracking.codigo_rastreio}
STATUS ATUAL: ${tracking.status}
HISTÓRICO DA ENCOMENDA:
${historicoFormatado}

INFORMAÇÕES SOBRE TAXAS E LIBERAÇÃO:
${taxaEnabled ? `- Se o cliente perguntar sobre retenção ou taxa, explique de forma cortês que existe a "${taxaNome}" no valor de R$ ${taxaValor} necessária para a liberação da entrega pelos Correios/Alfandegários, e que ele pode pagá-la diretamente pelo botão de liberação na tela de rastreamento.` : ''}

REGRAS DE RESPOSTA:
1. Seja extremamente cortês, empático, profissional e direto.
2. Responda em Português do Brasil com frases curtas (máximo 3 parágrafos).
3. Use emojis amigáveis (📦, 🚚, ✅, 💡).
4. Nunca invente dados falsos ou códigos de rastreio fora do contexto.`;

    if (!openaiKey) {
      // Resposta inteligente estática de fallback caso OpenAI Key não esteja preenchida
      const msgLower = userMessage.toLowerCase();
      let fallbackText = `Olá ${customerName}! 📦 Seu pedido #${orderData?.numero_pedido || ''} (código ${tracking.codigo_rastreio}) está registrado no nosso sistema com o status "${tracking.status}".`;
      
      if (msgLower.includes('taxa') || msgLower.includes('imposto') || msgLower.includes('pagar') || msgLower.includes('retido')) {
        fallbackText += `\n\n💡 Sobre taxas: Caso apareça o aviso de pendência de liberação na sua tela, você pode realizar o pagamento da taxa diretamente pelo botão destacado para liberar a entrega rápida da sua encomenda!`;
      } else {
        fallbackText += `\n\n🚚 Acompanhe as atualizações da linha do tempo na tela. Dúvidas adicionais podem ser enviadas diretamente ao nosso suporte.`;
      }

      return NextResponse.json({ reply: fallbackText });
    }

    // Chamada à API da OpenAI
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg['AI_MODEL'] || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 300,
      }),
    });

    if (!aiRes.ok) {
      const errData = await aiRes.json().catch(() => ({}));
      console.error('Erro na API OpenAI:', errData);
      return NextResponse.json({
        reply: `Olá ${customerName}! 📦 Seu pedido #${orderData?.numero_pedido || ''} está em processamento normal. Acompanhe a linha do tempo abaixo para mais detalhes.`
      });
    }

    const aiData = await aiRes.json();
    const reply = aiData.choices?.[0]?.message?.content || 'Como posso te ajudar com seu rastreamento?';

    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error('Erro na rota de AI Chat de Rastreio:', err);
    return NextResponse.json({ error: 'Erro interno ao processar resposta.' }, { status: 500 });
  }
}
