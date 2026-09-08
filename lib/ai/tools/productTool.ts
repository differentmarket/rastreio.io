import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ToolResult } from './types';

export interface ProductItem {
  titulo: string;
  quantidade: number;
  preco_unitario: number;
  sku?: string;
  variante?: string;
}

export interface ProductData {
  order_id: string;
  numero_pedido: string;
  total_itens: number;
  itens: ProductItem[];
}

/**
 * Consulta de itens e produtos comprados isolada por Loja (store_id).
 * A IA nunca deve consultar o banco diretamente.
 */
export async function productTool(
  storeId: string,
  params: { orderId: string }
): Promise<ToolResult<ProductData>> {
  if (!storeId) {
    return {
      found: false,
      data: null,
      reason: 'store_id obrigatório não informado.',
    };
  }

  const { orderId } = params;

  if (!orderId) {
    return {
      found: false,
      data: null,
      reason: 'orderId não informado para consulta de produtos.',
    };
  }

  try {
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id, store_id, numero_pedido, itens')
      .eq('store_id', storeId)
      .eq('id', orderId)
      .maybeSingle();

    if (error) {
      return {
        found: false,
        data: null,
        reason: `Erro ao consultar produtos do pedido: ${error.message}`,
      };
    }

    if (!order) {
      return {
        found: false,
        data: null,
        reason: 'Pedido não localizado nesta loja.',
      };
    }

    const rawItems: any[] = Array.isArray(order.itens) ? order.itens : [];

    if (rawItems.length === 0) {
      return {
        found: false,
        data: null,
        reason: 'O pedido foi localizado, mas não contém itens cadastrados.',
      };
    }

    const formattedItems: ProductItem[] = rawItems.map((item: any) => ({
      titulo: item.title || item.name || item.titulo || 'Produto',
      quantidade: Number(item.quantity || item.quantidade) || 1,
      preco_unitario: Number(item.price || item.preco || item.preco_unitario) || 0,
      sku: item.sku || undefined,
      variante: item.variant_title || item.variante || undefined,
    }));

    return {
      found: true,
      data: {
        order_id: order.id,
        numero_pedido: order.numero_pedido,
        total_itens: formattedItems.length,
        itens: formattedItems,
      },
      reason: 'Itens do pedido consultados com sucesso.',
    };
  } catch (err: any) {
    return {
      found: false,
      data: null,
      reason: `Exceção na consulta de produtos: ${err.message || err}`,
    };
  }
}
