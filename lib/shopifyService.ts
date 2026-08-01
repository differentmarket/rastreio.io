import { supabaseAdmin } from './supabaseAdmin';

interface ShopifyConfig {
  domain: string;
  token: string;
  webhookSecret: string;
}

/**
 * Recupera as chaves da Shopify da tabela settings ou das variáveis de ambiente.
 */
export async function getShopifyConfig(): Promise<ShopifyConfig> {
  const config = {
    domain: process.env.SHOPIFY_STORE_DOMAIN || '',
    token: process.env.SHOPIFY_ADMIN_TOKEN || '',
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
  };

  try {
    const { data: dbSettings } = await supabaseAdmin
      .from('settings')
      .select('key, value');

    if (dbSettings) {
      dbSettings.forEach((setting) => {
        if (setting.key === 'SHOPIFY_STORE_DOMAIN' && setting.value) {
          config.domain = setting.value;
        }
        if (setting.key === 'SHOPIFY_ADMIN_TOKEN' && setting.value) {
          config.token = setting.value;
        }
        if (setting.key === 'SHOPIFY_WEBHOOK_SECRET' && setting.value) {
          config.webhookSecret = setting.value;
        }
      });
    }
  } catch (err) {
    console.warn('Erro ao ler configurações do Supabase, usando padrão de env:', err);
  }

  return config;
}

/**
 * Envia o código de rastreamento de volta para o Shopify criando um Fulfillment.
 */
export async function enviarRastreioShopify(shopifyOrderId: number, codigoRastreio: string): Promise<boolean> {
  const config = await getShopifyConfig();

  if (!config.domain || !config.token || config.domain.includes('mock-store')) {
    console.log(`[Shopify Mock] Sincronizado código ${codigoRastreio} para o pedido Shopify ${shopifyOrderId}`);
    return true;
  }

  try {
    // 1. Obter Fulfillment Orders associados a este pedido
    const cleanDomain = config.domain.replace(/^https?:\/\//, '');
    const fulfillmentOrdersUrl = `https://${cleanDomain}/admin/api/2024-10/orders/${shopifyOrderId}/fulfillment_orders.json`;

    const resFo = await fetch(fulfillmentOrdersUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': config.token,
        'Content-Type': 'application/json',
      },
    });

    if (!resFo.ok) {
      const errText = await resFo.text();
      console.error(`Erro ao obter fulfillment orders para pedido ${shopifyOrderId}:`, errText);
      return false;
    }

    const foData = await resFo.json();
    const fulfillmentOrders = foData.fulfillment_orders || [];
    
    // Filtra o primeiro que não esteja concluído
    const activeFo = fulfillmentOrders.find(
      (fo: any) => fo.status === 'unfulfilled' || fo.status === 'in_progress'
    );

    if (!activeFo) {
      console.warn(`Nenhum fulfillment_order ativo encontrado para o pedido ${shopifyOrderId}. Talvez já esteja atendido.`);
      return false;
    }

    const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3002';
    const trackingUrl = `${host}/rastreio/${codigoRastreio}`;

    // 2. Criar o Fulfillment
    const fulfillmentUrl = `https://${cleanDomain}/admin/api/2024-10/fulfillments.json`;
    const payload = {
      fulfillment: {
        message: 'Código de rastreamento próprio gerado.',
        notify_customer: true,
        tracking_info: {
          number: codigoRastreio,
          url: trackingUrl,
          company: 'Rastreio Próprio',
        },
        line_items_by_fulfillment_order: [
          {
            fulfillment_order_id: activeFo.id,
            fulfillment_order_line_items: [],
          },
        ],
      },
    };

    const resFulfillment = await fetch(fulfillmentUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': config.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resFulfillment.ok) {
      const errText = await resFulfillment.text();
      console.error(`Erro ao criar fulfillment para pedido ${shopifyOrderId}:`, errText);
      return false;
    }

    console.log(`Sucesso ao enviar rastreio ${codigoRastreio} para o pedido Shopify ${shopifyOrderId}`);
    return true;
  } catch (error) {
    console.error(`Falha técnica na integração com Shopify para o pedido ${shopifyOrderId}:`, error);
    return false;
  }
}

/**
 * Atualiza o status do pedido na Shopify adicionando uma tag contendo o status de rastreio atual.
 */
export async function atualizarStatusPedidoShopify(shopifyOrderId: number, status: string): Promise<boolean> {
  const config = await getShopifyConfig();

  if (!config.domain || !config.token || config.domain.includes('mock-store')) {
    console.log(`[Shopify Mock Tag Update] Atualizado tag "Status: ${status}" para o pedido Shopify ${shopifyOrderId}`);
    return true;
  }

  try {
    const cleanDomain = config.domain.replace(/^https?:\/\//, '');
    const orderUrl = `https://${cleanDomain}/admin/api/2024-10/orders/${shopifyOrderId}.json`;

    // 1. Buscar tags atuais do pedido para não sobrescrever
    const getRes = await fetch(orderUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': config.token,
        'Content-Type': 'application/json',
      },
    });

    if (!getRes.ok) {
      console.error(`Erro ao obter tags do pedido ${shopifyOrderId}:`, await getRes.text());
      return false;
    }

    const { order } = await getRes.json();
    let tagsList = order.tags ? order.tags.split(',').map((t: string) => t.trim()) : [];
    
    // Remove tags de status antigas
    tagsList = tagsList.filter((tag: string) => !tag.startsWith('Status:'));
    
    // Adiciona a nova tag de status
    tagsList.push(`Status: ${status.replace('_', ' ').toUpperCase()}`);

    // 2. Atualizar o pedido com as novas tags
    const putRes = await fetch(orderUrl, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': config.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order: {
          id: shopifyOrderId,
          tags: tagsList.join(', '),
        },
      }),
    });

    if (!putRes.ok) {
      console.error(`Erro ao atualizar tags do pedido ${shopifyOrderId}:`, await putRes.text());
      return false;
    }

    console.log(`Sucesso ao atualizar tag de status do pedido ${shopifyOrderId} para: Status: ${status}`);
    return true;
  } catch (error) {
    console.error(`Erro técnico ao sincronizar status com Shopify para o pedido ${shopifyOrderId}:`, error);
    return false;
  }
}
