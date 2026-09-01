import { supabaseAdmin } from './supabaseAdmin';

export async function sendTrackingToGateway(
  orderId: string,
  codigoRastreio: string
): Promise<void> {
  try {
    // 1. Obter a configuração do webhook
    const { data: settingsData } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .in('key', ['GATEWAY_WEBHOOK_URL', 'GATEWAY_WEBHOOK_SECRET']);

    const cfg: Record<string, string> = {};
    settingsData?.forEach((s) => {
      cfg[s.key] = s.value;
    });

    const webhookUrl = cfg['GATEWAY_WEBHOOK_URL']?.trim();
    const webhookSecret = cfg['GATEWAY_WEBHOOK_SECRET']?.trim();

    if (!webhookUrl) {
      // Se não houver URL configurada, não faz nada silenciosamente
      return;
    }

    // 2. Obter os detalhes do pedido
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        store_id,
        shopify_order_id,
        numero_pedido,
        status_pedido,
        valor_total,
        created_at,
        customers (
          nome,
          email,
          telefone
        )
      `)
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      console.warn(`Gateway Webhook: Pedido ${orderId} não encontrado.`);
      return;
    }

    const customer: any = Array.isArray(order.customers) ? order.customers[0] : order.customers;

    // 3. Preparar o Payload
    const payload = {
      event: 'tracking.created',
      timestamp: new Date().toISOString(),
      order_id: order.id,
      store_id: order.store_id,
      shopify_order_id: order.shopify_order_id,
      order_number: order.numero_pedido,
      status: order.status_pedido,
      total_amount: order.valor_total,
      tracking_code: codigoRastreio,
      customer: {
        name: customer?.nome || '',
        email: customer?.email || '',
        phone: customer?.telefone || '',
      }
    };

    // 4. Preparar Headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (webhookSecret) {
      headers['Authorization'] = `Bearer ${webhookSecret}`;
      headers['X-Webhook-Secret'] = webhookSecret; // Compatibilidade com vários gateways
    }

    // 5. Enviar o Webhook
    // Executa assincronamente e não trava a execução principal (fire-and-forget logging)
    fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        console.error(`Gateway Webhook Error (${res.status}): ${text}`);
      } else {
        console.log(`Gateway Webhook Enviado p/ Pedido #${order.numero_pedido}`);
      }
    }).catch((err) => {
      console.error(`Gateway Webhook Network Error:`, err);
    });

  } catch (error) {
    console.error('Gateway Webhook General Error:', error);
  }
}
