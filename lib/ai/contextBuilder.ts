import { TrackingData } from './tools/trackingTool';
import { OrderData } from './tools/orderTool';
import { PaymentData } from './tools/paymentTool';
import { ProductData } from './tools/productTool';

export interface StoreAiConfig {
  nome_loja: string;
  whatsapp_suporte?: string;
  ai_tone?: string;
  system_prompt_custom?: string;
  commercial_rules?: string;
  max_discount_percent?: number;
  discount_coupon_code?: string;
}

export interface ContextPayload {
  storeConfig: StoreAiConfig;
  customerName?: string;
  order?: OrderData | null;
  tracking?: TrackingData | null;
  payment?: PaymentData | null;
  products?: ProductData | null;
  conversationSummary?: string;
}

const TONE_MAP: Record<string, string> = {
  amigavel: 'Tom amigável, acolhedor, prestativo e descontraído.',
  vendedor: 'Tom persuasivo, entusiasmado, focado em fechar a venda e oferecer benefícios e cupons.',
  formal: 'Tom corporativo, objetivo, educado e extremamente profissional.',
  empatico: 'Tom empático, calmo, paciente e atencioso para ouvir reclamações e resolver problemas.',
};

/**
 * Construtor de contexto seguro para a IA conversacional do WhatsApp.
 * Nunca expõe dados sensíveis nem credenciais.
 */
export function buildSystemPrompt(context: ContextPayload): string {
  const {
    storeConfig,
    customerName = 'Cliente',
    order,
    tracking,
    payment,
    products,
    conversationSummary,
  } = context;

  const tone = TONE_MAP[storeConfig.ai_tone || 'amigavel'] || TONE_MAP.amigavel;
  const storeName = storeConfig.nome_loja || 'Nossa Loja';
  const supportContact = storeConfig.whatsapp_suporte || 'Suporte Oficial';

  // Seção de Pedido
  let orderSection = 'Nenhum pedido localizado no momento.';
  if (order) {
    orderSection = `
- Pedido: #${order.numero_pedido}
- Status: ${order.status_pedido}
- Valor: R$ ${order.valor_total.toFixed(2)}
- Data: ${new Date(order.data_pedido).toLocaleDateString('pt-BR')}
    `.trim();
  }

  // Seção de Rastreio
  let trackingSection = 'Sem rastreamento disponível no momento.';
  if (tracking) {
    trackingSection = `
- Código: ${tracking.codigo_rastreio}
- Situação da Entrega: ${tracking.status}
- Link de Rastreio Oficial: ${tracking.link_rastreio}
- Última Movimentação: ${
      tracking.historico && tracking.historico.length > 0
        ? JSON.stringify(tracking.historico.slice(-2))
        : 'Em preparação'
    }
    `.trim();
  }

  // Seção de Pagamento
  let paymentSection = 'Informações de pagamento padrão.';
  if (payment) {
    paymentSection = `
- Status Pagamento: ${payment.status_pagamento}
- Valor Original: R$ ${payment.valor_original.toFixed(2)}
- Valor com Desconto: R$ ${payment.valor_final.toFixed(2)}
- Link de Pagamento Seguro: ${payment.link_pagamento || 'Solicite ao atendente'}
- Cupom Aplicado: ${payment.cupom_aplicado || 'Nenhum'}
- Teto de Desconto Permitido pela Loja: ${payment.limite_desconto_loja}%
    `.trim();
  }

  // Seção de Produtos
  let productSection = 'Itens não especificados.';
  if (products && products.itens.length > 0) {
    productSection = products.itens
      .map(
        (i) =>
          `- ${i.quantidade}x ${i.titulo} (${i.variante || 'Padrão'}) - R$ ${i.preco_unitario.toFixed(2)}`
      )
      .join('\n');
  }

  // Regras Comerciais da Loja
  const commercialRules = storeConfig.commercial_rules
    ? `\nREGRAS COMERCIAIS ADICIONAIS DA LOJA:\n${storeConfig.commercial_rules}`
    : '';

  // Instruções Específicas do Lojista
  const customInstructions = storeConfig.system_prompt_custom
    ? `\nINSTRUÇÕES ESPECÍFICAS:\n${storeConfig.system_prompt_custom}`
    : '';

  // Resumo anterior se existir
  const summarySection = conversationSummary
    ? `\nRESUMO DA CONVERSA ANTERIOR:\n${conversationSummary}\n`
    : '';

  return `
Você é o assistente virtual oficial e inteligente da loja "${storeName}".
Seu objetivo é tirar dúvidas do cliente sobre seus pedidos, entregas, produtos e pagamentos com precisão, agilidade e simpatia.

CLIENTE: ${customerName}

TOM DE VOZ:
${tone}

DADOS DA LOJA:
- Loja: ${storeName}
- Suporte de Atendimento Humano: ${supportContact}
${storeConfig.discount_coupon_code ? `- Cupom Especial da Loja: ${storeConfig.discount_coupon_code}` : ''}
${commercialRules}
${customInstructions}

DADOS DO PEDIDO:
${orderSection}

DADOS DO RASTREAMENTO:
${trackingSection}

DADOS DE PAGAMENTO:
${paymentSection}

ITENS DO PEDIDO:
${productSection}
${summarySection}

DIRETRIZES FUNDAMENTAIS DE RESPOSTA:
1. Responda em Português do Brasil com clareza, empatia e sem enrolação (máximo 2 a 4 frases por resposta).
2. NUNCA invente prazos, códigos de rastreio ou status que não constem nos dados acima.
3. Se o cliente perguntar o rastreio, forneça o link oficial ${tracking ? tracking.link_rastreio : 'assim que disponível'}.
4. Se o cliente solicitar desconto, JAMAIS conceda desconto superior a ${storeConfig.max_discount_percent || 0}%.
5. Se o cliente solicitar expressamente falar com um atendente humano ou se irritar, informe educadamente que está transferindo para o suporte humano e forneça o contato ${supportContact}.
  `.trim();
}
