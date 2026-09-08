import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ToolResult } from './types';

export interface OrderData {
  id: string;
  numero_pedido: string;
  status_pedido: string;
  valor_total: number;
  data_pedido: string;
  customer_name?: string;
  customer_phone?: string;
}

/**
 * Consulta de pedido isolada estritamente por Loja (store_id).
 * A IA nunca deve consultar o banco diretamente.
 */
export async function orderTool(
  storeId: string,
  params: { customerPhone?: string; orderNumber?: string; orderId?: string }
): Promise<ToolResult<OrderData>> {
  if (!storeId) {
    return {
      found: false,
      data: null,
      reason: 'store_id obrigatório não informado.',
    };
  }

  const { customerPhone, orderNumber, orderId } = params;

  try {
    // 1. Busca direta por orderId
    if (orderId) {
      const { data: order, error } = await supabaseAdmin
        .from('orders')
        .select('id, store_id, numero_pedido, status_pedido, valor_total, created_at, customer_id')
        .eq('store_id', storeId)
        .eq('id', orderId)
        .maybeSingle();

      if (error) {
        return {
          found: false,
          data: null,
          reason: `Erro ao buscar pedido por ID: ${error.message}`,
        };
      }

      if (order) {
        let customerName = 'Cliente';
        if (order.customer_id) {
          const { data: cust } = await supabaseAdmin
            .from('customers')
            .select('nome, telefone')
            .eq('id', order.customer_id)
            .maybeSingle();
          if (cust?.nome) customerName = cust.nome;
        }

        return {
          found: true,
          data: {
            id: order.id,
            numero_pedido: order.numero_pedido,
            status_pedido: order.status_pedido,
            valor_total: Number(order.valor_total) || 0,
            data_pedido: order.created_at,
            customer_name: customerName,
          },
          reason: 'Pedido localizado por ID com sucesso.',
        };
      }
    }

    // 2. Busca por orderNumber
    if (orderNumber) {
      const cleanNumber = orderNumber.replace(/\D/g, '');
      const { data: order, error } = await supabaseAdmin
        .from('orders')
        .select('id, store_id, numero_pedido, status_pedido, valor_total, created_at, customer_id')
        .eq('store_id', storeId)
        .or(`numero_pedido.eq.${cleanNumber},numero_pedido.eq.#${cleanNumber}`)
        .limit(1)
        .maybeSingle();

      if (error) {
        return {
          found: false,
          data: null,
          reason: `Erro ao buscar pedido por número: ${error.message}`,
        };
      }

      if (order) {
        let customerName = 'Cliente';
        if (order.customer_id) {
          const { data: cust } = await supabaseAdmin
            .from('customers')
            .select('nome')
            .eq('id', order.customer_id)
            .maybeSingle();
          if (cust?.nome) customerName = cust.nome;
        }

        return {
          found: true,
          data: {
            id: order.id,
            numero_pedido: order.numero_pedido,
            status_pedido: order.status_pedido,
            valor_total: Number(order.valor_total) || 0,
            data_pedido: order.created_at,
            customer_name: customerName,
          },
          reason: 'Pedido localizado por número com sucesso.',
        };
      }
    }

    // 3. Busca pelo telefone do cliente (últimos 8 dígitos para cobrir DDI/DDD)
    if (customerPhone) {
      const cleanPhone = customerPhone.replace(/\D/g, '');
      const lastDigits = cleanPhone.slice(-8);

      if (lastDigits.length >= 8) {
        // Localiza clientes que correspondam ao telefone
        const { data: customers } = await supabaseAdmin
          .from('customers')
          .select('id, nome, telefone')
          .ilike('telefone', `%${lastDigits}%`)
          .limit(5);

        if (customers && customers.length > 0) {
          const customerIds = customers.map((c) => c.id);

          // Busca o pedido mais recente associado a estes clientes E estritamente nesta loja
          const { data: order, error } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, numero_pedido, status_pedido, valor_total, created_at, customer_id')
            .eq('store_id', storeId)
            .in('customer_id', customerIds)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) {
            return {
              found: false,
              data: null,
              reason: `Erro ao buscar pedidos do cliente: ${error.message}`,
            };
          }

          if (order) {
            const matchedCust = customers.find((c) => c.id === order.customer_id);
            return {
              found: true,
              data: {
                id: order.id,
                numero_pedido: order.numero_pedido,
                status_pedido: order.status_pedido,
                valor_total: Number(order.valor_total) || 0,
                data_pedido: order.created_at,
                customer_name: matchedCust?.nome || 'Cliente',
                customer_phone: matchedCust?.telefone || customerPhone,
              },
              reason: 'Pedido mais recente do cliente localizado com sucesso.',
            };
          }
        }
      }
    }

    return {
      found: false,
      data: null,
      reason: 'Nenhum pedido recente localizado para este cliente nesta loja.',
    };
  } catch (err: any) {
    return {
      found: false,
      data: null,
      reason: `Exceção na consulta de pedido: ${err.message || err}`,
    };
  }
}
