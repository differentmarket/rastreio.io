import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ToolResult } from './types';

export interface PaymentData {
  order_id: string;
  status_pagamento: string;
  valor_original: number;
  valor_final: number;
  link_pagamento?: string;
  cupom_aplicado?: string;
  desconto_percentual_aplicado: number;
  limite_desconto_loja: number;
}

/**
 * Consulta e geração de dados de pagamento com controle comercial rígido.
 * A IA nunca deve consultar o banco diretamente nem conceder descontos acima de max_discount_percent.
 */
export async function paymentTool(
  storeId: string,
  params: { orderId: string; requestedDiscountPercent?: number }
): Promise<ToolResult<PaymentData>> {
  if (!storeId) {
    return {
      found: false,
      data: null,
      reason: 'store_id obrigatório não informado.',
    };
  }

  const { orderId, requestedDiscountPercent = 0 } = params;

  if (!orderId) {
    return {
      found: false,
      data: null,
      reason: 'orderId não fornecido para consulta de pagamento.',
    };
  }

  try {
    // 1. Busca o pedido estritamente isolado pela loja
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('id, store_id, numero_pedido, status_pedido, valor_total, raw_payload')
      .eq('store_id', storeId)
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr) {
      return {
        found: false,
        data: null,
        reason: `Erro ao buscar pedido para pagamento: ${orderErr.message}`,
      };
    }

    if (!order) {
      return {
        found: false,
        data: null,
        reason: 'Pedido não localizado nesta loja.',
      };
    }

    // 2. Busca configuração da IA da loja para obter teto comercial (max_discount_percent e cupom)
    const { data: aiConfig } = await supabaseAdmin
      .from('ai_agents_config')
      .select('max_discount_percent, discount_coupon_code, auto_discount_enabled')
      .eq('store_id', storeId)
      .maybeSingle();

    const maxAllowedDiscount = Math.max(0, Number(aiConfig?.max_discount_percent) || 0);
    const storeCoupon = aiConfig?.discount_coupon_code || '';

    // Aplicação segura do desconto: nunca ultrapassar maxAllowedDiscount
    let appliedDiscount = 0;
    if (aiConfig?.auto_discount_enabled && maxAllowedDiscount > 0) {
      appliedDiscount = Math.min(Math.max(0, requestedDiscountPercent), maxAllowedDiscount);
    }

    const valorOriginal = Number(order.valor_total) || 0;
    const valorFinal = Number((valorOriginal * (1 - appliedDiscount / 100)).toFixed(2));

    // Links de pagamento extraídos do payload seguro da Shopify / VeoPag
    const raw = order.raw_payload || {};
    const linkPagamento =
      raw.order_status_url ||
      raw.checkout_url ||
      raw.checkout_payment_url ||
      raw.invoice_url ||
      undefined;

    let reasonMsg = 'Informações de pagamento obtidas com sucesso.';
    if (requestedDiscountPercent > maxAllowedDiscount) {
      reasonMsg = `Desconto solicitado (${requestedDiscountPercent}%) excede o teto permitido pela loja (${maxAllowedDiscount}%). O desconto foi limitado a ${maxAllowedDiscount}%.`;
    }

    return {
      found: true,
      data: {
        order_id: order.id,
        status_pagamento: order.status_pedido,
        valor_original: valorOriginal,
        valor_final: valorFinal,
        link_pagamento: linkPagamento,
        cupom_aplicado: appliedDiscount > 0 ? storeCoupon : undefined,
        desconto_percentual_aplicado: appliedDiscount,
        limite_desconto_loja: maxAllowedDiscount,
      },
      reason: reasonMsg,
    };
  } catch (err: any) {
    return {
      found: false,
      data: null,
      reason: `Exceção na consulta de pagamento: ${err.message || err}`,
    };
  }
}
