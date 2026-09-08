export type IntentType =
  | 'human_handoff'
  | 'tracking_status'
  | 'order_status'
  | 'payment_doubt'
  | 'product_doubt'
  | 'general_greeting'
  | 'unknown';

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  extractedKeywords: string[];
  isHandoff: boolean;
}

const DEFAULT_HANDOFF_KEYWORDS = [
  'humano',
  'atendente',
  'pessoa',
  'falar com alguém',
  'suporte humano',
  'atendimento humano',
  'falar com pessoa',
  'procon',
  'reclame aqui',
  'cancelar',
  'golpe',
  'fraude',
  'advogado',
  'policia',
];

const TRACKING_KEYWORDS = [
  'rastreio',
  'rastrear',
  'codigo',
  'código',
  'onde esta',
  'onde está',
  'chega quando',
  'prazo',
  'entrega',
  'enviado',
  'correios',
  'transportadora',
  'despachado',
];

const PAYMENT_KEYWORDS = [
  'pagar',
  'pagamento',
  'pix',
  'boleto',
  'cartao',
  'cartão',
  'link',
  'desconto',
  'cupom',
  'segunda via',
  'chave pix',
  'comprovante',
];

const ORDER_KEYWORDS = [
  'meu pedido',
  'status do pedido',
  'compra',
  'confirmacao',
  'confirmação',
  'aprovado',
  'numero do pedido',
  'número do pedido',
];

const PRODUCT_KEYWORDS = [
  'produto',
  'o que vem',
  'cor',
  'tamanho',
  'garantia',
  'voltagem',
  'modelo',
  'especificação',
  'manual',
  'como usar',
];

const GREETING_KEYWORDS = [
  'oi',
  'ola',
  'olá',
  'bom dia',
  'boa tarde',
  'boa noite',
  'tudo bem',
  'opa',
  'ola tudo bem',
];

/**
 * Classificador de intenções rápido baseado em regras léxicas e heurísticas.
 * Permite resposta instantânea com 0 custo de tokens para intenções críticas (ex: handoff).
 */
export function classifyIntent(
  message: string,
  customHandoffTriggers: string[] = []
): IntentResult {
  const clean = (message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (!clean) {
    return {
      intent: 'unknown',
      confidence: 0,
      extractedKeywords: [],
      isHandoff: false,
    };
  }

  // 1. Checa gatilhos de Handoff Humano (padrão + customizados da loja)
  const allHandoffTriggers = [
    ...DEFAULT_HANDOFF_KEYWORDS,
    ...customHandoffTriggers.map((t) =>
      t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    ),
  ];

  const matchedHandoff = allHandoffTriggers.filter((keyword) => {
    if (!keyword) return false;
    // Regex de palavra inteira ou frase contida
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(clean) || clean.includes(keyword);
  });

  if (matchedHandoff.length > 0) {
    return {
      intent: 'human_handoff',
      confidence: 0.95,
      extractedKeywords: matchedHandoff,
      isHandoff: true,
    };
  }

  // 2. Rastreamento e Logística
  const matchedTracking = TRACKING_KEYWORDS.filter((k) => clean.includes(k));
  if (matchedTracking.length > 0) {
    return {
      intent: 'tracking_status',
      confidence: 0.9,
      extractedKeywords: matchedTracking,
      isHandoff: false,
    };
  }

  // 3. Pagamento e Desconto
  const matchedPayment = PAYMENT_KEYWORDS.filter((k) => clean.includes(k));
  if (matchedPayment.length > 0) {
    return {
      intent: 'payment_doubt',
      confidence: 0.88,
      extractedKeywords: matchedPayment,
      isHandoff: false,
    };
  }

  // 4. Status de Pedido
  const matchedOrder = ORDER_KEYWORDS.filter((k) => clean.includes(k));
  if (matchedOrder.length > 0) {
    return {
      intent: 'order_status',
      confidence: 0.85,
      extractedKeywords: matchedOrder,
      isHandoff: false,
    };
  }

  // 5. Dúvida de Produto
  const matchedProduct = PRODUCT_KEYWORDS.filter((k) => clean.includes(k));
  if (matchedProduct.length > 0) {
    return {
      intent: 'product_doubt',
      confidence: 0.8,
      extractedKeywords: matchedProduct,
      isHandoff: false,
    };
  }

  // 6. Saudação Geral
  const matchedGreeting = GREETING_KEYWORDS.filter((k) => {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped}\\b|\\b${escaped}$|\\b${escaped}\\b`, 'i');
    return regex.test(clean);
  });
  if (matchedGreeting.length > 0) {
    return {
      intent: 'general_greeting',
      confidence: 0.85,
      extractedKeywords: matchedGreeting,
      isHandoff: false,
    };
  }

  return {
    intent: 'unknown',
    confidence: 0.5,
    extractedKeywords: [],
    isHandoff: false,
  };
}
