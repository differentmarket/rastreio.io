import { supabaseAdmin } from './supabaseAdmin';

interface ShopifyConfig {
  domain: string;
  token: string;
  webhookSecret: string;
}

/**
 * Recupera as chaves da Shopify da tabela stores (se fornecido storeId) ou da tabela settings / variáveis de ambiente.
 */
export async function getShopifyConfig(storeId?: string): Promise<ShopifyConfig> {
  const config = {
    domain: process.env.SHOPIFY_STORE_DOMAIN || '',
    token: process.env.SHOPIFY_ADMIN_TOKEN || '',
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
  };

  try {
    // 1. Se storeId for informado, busca os dados da loja na tabela stores
    if (storeId && storeId !== 'all' && storeId !== 'default-store') {
      const { data: storeData } = await supabaseAdmin
        .from('stores')
        .select('shopify_domain, shopify_access_token, shopify_webhook_secret')
        .eq('id', storeId)
        .maybeSingle();

      if (storeData) {
        if (storeData.shopify_domain) config.domain = storeData.shopify_domain;
        if (storeData.shopify_access_token) config.token = storeData.shopify_access_token;
        if (storeData.shopify_webhook_secret) config.webhookSecret = storeData.shopify_webhook_secret;
        return config;
      }
    }

    // 2. Busca da tabela settings (para a loja principal / legacy)
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
