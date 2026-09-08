import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ToolResult } from './types';

export interface TrackingData {
  codigo_rastreio: string;
  status: string;
  historico: any[];
  link_rastreio: string;
  data_atualizacao?: string;
}

/**
 * Consulta de rastreamento logístico isolada por Loja (store_id).
 * A IA nunca deve consultar o banco diretamente.
 */
export async function trackingTool(
  storeId: string,
  params: { orderId?: string; orderNumber?: string; trackingCode?: string }
): Promise<ToolResult<TrackingData>> {
  if (!storeId) {
    return {
      found: false,
      data: null,
      reason: 'store_id obrigatório não informado.',
    };
  }

  const { orderId, orderNumber, trackingCode } = params;

  try {
    // 1. Busca direta por código de rastreio se fornecido
    if (trackingCode && trackingCode.trim()) {
      const cleanCode = trackingCode.trim().toUpperCase();
      const { data: tracking, error } = await supabaseAdmin
        .from('trackings')
        .select('id, store_id, codigo_rastreio, status, historico, updated_at')
        .eq('store_id', storeId)
        .eq('codigo_rastreio', cleanCode)
        .maybeSingle();

      if (error) {
        return {
          found: false,
          data: null,
          reason: `Erro ao consultar código de rastreio: ${error.message}`,
        };
      }

      if (tracking) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
        return {
          found: true,
          data: {
            codigo_rastreio: tracking.codigo_rastreio,
            status: tracking.status || 'Em trânsito',
            historico: Array.isArray(tracking.historico) ? tracking.historico : [],
            link_rastreio: `${appUrl}/rastreio/${tracking.codigo_rastreio}`,
            data_atualizacao: tracking.updated_at,
          },
          reason: 'Código de rastreio localizado com sucesso.',
        };
      }
    }

    // 2. Busca por orderId ou orderNumber
    let targetOrderId = orderId;

    if (!targetOrderId && orderNumber) {
      const cleanNumber = orderNumber.replace(/\D/g, '');
      const { data: order } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('store_id', storeId)
        .or(`numero_pedido.eq.${cleanNumber},numero_pedido.eq.#${cleanNumber}`)
        .limit(1)
        .maybeSingle();

      if (order) {
        targetOrderId = order.id;
      }
    }

    if (targetOrderId) {
      const { data: tracking, error } = await supabaseAdmin
        .from('trackings')
        .select('id, store_id, codigo_rastreio, status, historico, updated_at')
        .eq('store_id', storeId)
        .eq('order_id', targetOrderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return {
          found: false,
          data: null,
          reason: `Erro ao buscar rastreio do pedido: ${error.message}`,
        };
      }

      if (tracking && tracking.codigo_rastreio) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
        return {
          found: true,
          data: {
            codigo_rastreio: tracking.codigo_rastreio,
            status: tracking.status || 'Em trânsito',
            historico: Array.isArray(tracking.historico) ? tracking.historico : [],
            link_rastreio: `${appUrl}/rastreio/${tracking.codigo_rastreio}`,
            data_atualizacao: tracking.updated_at,
          },
          reason: 'Rastreio do pedido localizado com sucesso.',
        };
      }

      return {
        found: false,
        data: null,
        reason: 'O pedido foi localizado, mas o código de rastreio ainda não foi gerado pela transportadora.',
      };
    }

    return {
      found: false,
      data: null,
      reason: 'Nenhum rastreamento encontrado para os parâmetros fornecidos nesta loja.',
    };
  } catch (err: any) {
    return {
      found: false,
      data: null,
      reason: `Exceção na consulta de rastreamento: ${err.message || err}`,
    };
  }
}
