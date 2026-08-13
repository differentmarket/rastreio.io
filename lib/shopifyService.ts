import { supabaseAdmin } from './supabaseAdmin';

interface ShopifyConfig {
  domain: string;
  token: string;
  webhookSecret: string;
}

/**
 * Renova o token Shopify via client_credentials grant.
 * O token expira em 24h, então chamamos isso antes de cada operação.
 */
async function refreshShopifyToken(domain: string): Promise<string | null> {
  const clientId = process.env.SHOPIFY_CLIENT_ID || '';
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || '';

  if (!clientId || !clientSecret || !domain) return null;

  try {
    const cleanDomain = domain.replace(/^https?:\/\//, '');
    const res = await fetch(`https://${cleanDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
    });

    if (!res.ok) {
      console.warn('[Shopify] Falha ao renovar token:', await res.text());
      return null;
    }

    const data = await res.json();
    const newToken: string = data.access_token;

    if (newToken) {
      // Persiste o token renovado no banco para o painel admin refletir
      await supabaseAdmin
        .from('settings')
        .upsert([{ key: 'SHOPIFY_ADMIN_TOKEN', value: newToken }], { onConflict: 'key' });

      console.log('[Shopify] Token renovado com sucesso.');
    }

    return newToken || null;
  } catch (err) {
    console.warn('[Shopify] Erro ao tentar renovar token:', err);
    return null;
  }
}

/**
 * Recupera as chaves da Shopify da tabela settings ou das variáveis de ambiente.
 * Sempre renova o token antes de retornar para garantir que não está expirado.
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

  // Renova o token automaticamente antes de cada uso
  if (config.domain && !config.domain.includes('mock-store')) {
    const freshToken = await refreshShopifyToken(config.domain);
    if (freshToken) config.token = freshToken;
  }

  return config;
}

/**
 * Detecta a transportadora com base no nome do método de envio (shipping line title) do pedido.
 * Retorna { company, url } para uso no fulfillment da Shopify.
 */
function detectarTransportadora(shippingMethodTitle: string | null, codigoRastreio: string): { company: string; url: string } {
  const title = (shippingMethodTitle || '').toLowerCase();
  const codigo = (codigoRastreio || '').toUpperCase();

  // Correios — formatos: AA000000000BR (13 chars) ou por nome do método
  const isCorreiosCode = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(codigo);
  if (
    isCorreiosCode ||
    title.includes('correio') ||
    title.includes('pac') ||
    title.includes('sedex') ||
    title.includes('mini envio') ||
    title.includes('carta registrada')
  ) {
    return {
      company: 'Correios',
      url: `https://www.correios.com.br/rastreamento?codigo=${codigoRastreio}`,
    };
  }

  // Jadlog
  if (title.includes('jadlog') || title.includes('jad log')) {
    return {
      company: 'Jadlog',
      url: `https://jadlog.com.br/siteinfo/tracking.jad?cte=${codigoRastreio}`,
    };
  }

  // Total Express
  if (title.includes('total express') || title.includes('totalexpress')) {
    return {
      company: 'Total Express',
      url: `https://totalexpress.com.br/rastreio?codigo=${codigoRastreio}`,
    };
  }

  // Azul Cargo
  if (title.includes('azul') || title.includes('azul cargo')) {
    return {
      company: 'Azul Cargo',
      url: `https://www.azulcargo.com.br/home/rastreio?awb=${codigoRastreio}`,
    };
  }

  // Loggi
  if (title.includes('loggi')) {
    return {
      company: 'Loggi',
      url: `https://www.loggi.com/rastreador/?q=${codigoRastreio}`,
    };
  }

  // J&T Express
  if (title.includes('j&t') || title.includes('j e t') || title.includes('jt express')) {
    return {
      company: 'J&T Express',
      url: `https://www.jtexpress.com.br/index/query/gzquery.html?bills=${codigoRastreio}`,
    };
  }

  // Flash Courier
  if (title.includes('flash')) {
    return {
      company: 'Flash Courier',
      url: `https://flashcourier.com.br/rastreio/${codigoRastreio}`,
    };
  }

  let appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app').trim().replace(/\/+$/, '').replace(/\/rastreio$/, '');
  if (!appUrl || appUrl.includes('localhost') || appUrl.includes('ri7o2sjad')) {
    appUrl = 'https://rastreio-io.vercel.app';
  }
  return {
    company: 'Rastreio Próprio',
    url: `${appUrl}/rastreio/${codigoRastreio}`,
  };
}

/**
 * Envia o código de rastreamento de volta para o Shopify criando um Fulfillment.
 * @param shopifyOrderId   ID numérico do pedido na Shopify
 * @param codigoRastreio   Código de rastreio
 * @param shippingMethod   Título do método de envio selecionado pelo cliente (ex: "PAC", "Jadlog")
 */
export async function enviarRastreioShopify(
  shopifyOrderId: number,
  codigoRastreio: string,
  shippingMethod?: string | null
): Promise<boolean> {
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
      (fo: any) => fo.status === 'open' || fo.status === 'in_progress'
    );

    if (!activeFo) {
      console.warn(`Nenhum fulfillment_order ativo encontrado para o pedido ${shopifyOrderId}. Talvez já esteja atendido.`);
      return false;
    }

    // Detectar transportadora automaticamente
    const transportadora = detectarTransportadora(shippingMethod || null, codigoRastreio);

    console.log(`[Shopify] Usando transportadora: ${transportadora.company} para pedido ${shopifyOrderId}`);

    // Mapear os itens a serem atendidos
    const foLineItems = (activeFo.line_items || []).map((li: any) => ({
      id: li.id,
      quantity: li.fulfillable_quantity || li.quantity || 1,
    }));

    // 2. Criar o Fulfillment com carrier correto
    const fulfillmentUrl = `https://${cleanDomain}/admin/api/2024-10/fulfillments.json`;
    const payload = {
      fulfillment: {
        message: `Pedido enviado via ${transportadora.company}.`,
        notify_customer: false, // Notificamos via Resend — evita e-mail duplicado
        tracking_info: {
          number: codigoRastreio,
          url: transportadora.url,
          company: transportadora.company,
        },
        line_items_by_fulfillment_order: [
          {
            fulfillment_order_id: activeFo.id,
            ...(foLineItems.length > 0 && { fulfillment_order_line_items: foLineItems }),
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
