import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';
import { enviarRastreioShopify } from '@/lib/shopifyService';

export const dynamic = 'force-dynamic';

// ── Helpers de Data/Dia Útil ──────────────────────────────────────
function getStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Retorna true se o pedido foi criado ANTES de hoje (= pode receber rastreio agora) */
function isAnteriorAHoje(orderCreatedAt: string): boolean {
  const orderDay = getStartOfDay(new Date(orderCreatedAt));
  const todayDay = getStartOfDay(new Date());
  return orderDay < todayDay;
}

/** Retorna true se já passaram X horas desde a criação do pedido */
function passouDelayHoras(orderCreatedAt: string, delayHoras: number): boolean {
  const agora = Date.now();
  const criado = new Date(orderCreatedAt).getTime();
  const horasPassadas = (agora - criado) / (1000 * 60 * 60);
  return horasPassadas >= delayHoras;
}

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    // periodo: 'hoje' | 'ontem' | 'semana' | 'mes' | 'pendentes' | 'todos' | 'exceto_hoje'
    // tipoNotificacao: 'rastreio' | 'nota' | 'ambos'
    // forcarHoje: true = ignora regra de próximo dia útil para rastreio
    const { periodo, tipoNotificacao, forcarHoje = false, orderId = null } = body;
    const tipo = tipoNotificacao || 'ambos';

    // ── Carregar configurações de disparo ─────────────────────────
    const { data: settings } = await supabaseAdmin.from('settings').select('key, value');
    const cfg: Record<string, string> = {};
    settings?.forEach(s => { cfg[s.key] = s.value; });

    // Carregar todas as lojas para isolamento de dados fiscais (Multi-Tenant)
    const { data: storesList } = await supabaseAdmin.from('stores').select('*');
    const storesMap = new Map<string, any>((storesList || []).map(s => [s.id, s]));

    const resendApiKey = cfg['RESEND_API_KEY'] || '';
    let fromEmail = cfg['RESEND_FROM_EMAIL'] || 'Rastreio <onboarding@resend.dev>';
    if (fromEmail.includes('seudominio.com')) {
      fromEmail = 'Rastreio <onboarding@resend.dev>';
    }
    let rawAppUrl = cfg['NEXT_PUBLIC_APP_URL'] || process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
    rawAppUrl = rawAppUrl.trim().replace(/\/+$/, '').replace(/\/rastreio$/, '');
    if (!rawAppUrl || rawAppUrl.includes('localhost') || rawAppUrl.includes('ri7o2sjad')) {
      rawAppUrl = 'https://rastreio-io.vercel.app';
    }
    const appUrl = rawAppUrl;
    const empresaNome = cfg['EMPRESA_NOME'] || 'Minha Loja';
    const notaDelayHoras = parseFloat(cfg['NOTA_DELAY_HORAS'] || '2');
    const rastreioProximoDiaUtil = cfg['RASTREIO_PROXIMO_DIA_UTIL'] !== 'false'; // padrão: true

    const storeIdParam = body.store_id || null;

    // ── Buscar pedidos (Apenas pedidos PAGOS são elegíveis para e-mails) ──
    let query = supabaseAdmin.from('orders').select(`
      id, store_id, shopify_order_id, numero_pedido, status_pedido, valor_total,
      itens, raw_payload, created_at,
      customers ( nome, email ),
      addresses ( logradouro, numero, complemento, bairro, cidade, estado, cep ),
      trackings ( id, codigo_rastreio, status, email_enviado, shopify_synced )
    `).eq('status_pedido', 'pago');

    if (storeIdParam && storeIdParam !== 'all' && storeIdParam !== 'default-store') {
      query = query.eq('store_id', storeIdParam);
    }

    const now = new Date();
    if (orderId) {
      query = query.eq('id', orderId);
    } else if (periodo === 'hoje') {
      const todayStart = getStartOfDay(now).toISOString();
      query = query.gte('created_at', todayStart);
    } else if (periodo === 'ontem') {
      const yesterdayStart = getStartOfDay(new Date(now.getTime() - 86400000)).toISOString();
      const todayStart = getStartOfDay(now).toISOString();
      query = query.gte('created_at', yesterdayStart).lt('created_at', todayStart);
    } else if (periodo === 'semana') {
      const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
      query = query.gte('created_at', weekAgo);
    } else if (periodo === 'mes') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      query = query.gte('created_at', monthStart);
    } else if (periodo === 'exceto_hoje') {
      // Busca pedidos criados antes do dia de hoje.
      const todayStart = getStartOfDay(now).toISOString();
      const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();

      const { data: checkOrders } = await supabaseAdmin.from('orders').select('id').lt('created_at', todayStart).limit(1);
      if (checkOrders && checkOrders.length > 0) {
        query = query.lt('created_at', todayStart);
      } else {
        const { data: check2h } = await supabaseAdmin.from('orders').select('id').lt('created_at', twoHoursAgo).limit(1);
        if (check2h && check2h.length > 0) {
          query = query.lt('created_at', twoHoursAgo);
        }
        // Se nenhum order tem data antiga (pois foram todos sincronizados recentemente), busca sem restrição estrita de data
      }
    }

    const { data: initialOrders, error } = await query;
    if (error) {
      return NextResponse.json({ error: 'Erro ao buscar pedidos.' }, { status: 500 });
    }

    let orders = initialOrders || [];

    // Fallback: Se o filtro por data exata (ex: 'ontem' ou 'exceto_hoje') não encontrou pedidos, busca todos os pedidos pagos
    if (orders.length === 0 && (periodo === 'ontem' || periodo === 'exceto_hoje' || periodo === 'pendentes')) {
      let fallbackQuery = supabaseAdmin.from('orders').select(`
        id, store_id, shopify_order_id, numero_pedido, status_pedido, valor_total,
        itens, raw_payload, created_at,
        customers ( nome, email ),
        addresses ( logradouro, numero, complemento, bairro, cidade, estado, cep ),
        trackings ( id, codigo_rastreio, status, email_enviado, shopify_synced )
      `).eq('status_pedido', 'pago');

      if (storeIdParam && storeIdParam !== 'all' && storeIdParam !== 'default-store') {
        fallbackQuery = fallbackQuery.eq('store_id', storeIdParam);
      }
      const { data: fallbackOrders } = await fallbackQuery;
      if (fallbackOrders && fallbackOrders.length > 0) {
        orders = fallbackOrders;
      }
    }

    // ── Filtrar elegíveis com base nas regras de negócio ──────────
    const isManualTrigger = forcarHoje || periodo === 'exceto_hoje' || periodo === 'pendentes' || periodo === 'todos' || periodo === 'hoje' || periodo === 'ontem' || periodo === 'semana' || periodo === 'mes';

    const targetOrders = orders.filter((o: any) => {
      const cust = Array.isArray(o.customers) ? o.customers[0] : o.customers;
      const trk  = Array.isArray(o.trackings) ? o.trackings[0] : o.trackings;
      const email = cust?.email || o.raw_payload?.customer?.email || o.raw_payload?.email || o.raw_payload?.contact_email || '';

      if (!email) return false;

      const notaJaEnviada     = o.raw_payload?.nota_enviada === true;
      const rastreioJaEnviado  = trk?.email_enviado === true;
      const criadoEmDiaAnterior = isAnteriorAHoje(o.created_at);

      // REGRA 1: Não pode enviar rastreio no mesmo dia da compra (criadoEmDiaAnterior === true)
      // REGRA 2: Não pode enviar rastreio sem a Nota Fiscal ter sido enviada antes (notaJaEnviada === true)
      const podeEnviarNota = !notaJaEnviada && (isManualTrigger || passouDelayHoras(o.created_at, notaDelayHoras));
      const podeEnviarRastreio = !rastreioJaEnviado && criadoEmDiaAnterior && notaJaEnviada;

      if (tipo === 'rastreio') return podeEnviarRastreio;
      if (tipo === 'nota')     return podeEnviarNota;
      return podeEnviarRastreio || podeEnviarNota;
    });

    let disparados = 0;
    let pulados = orders.length - targetOrders.length;
    let erros = 0;

    for (const order of targetOrders) {
      const cust = Array.isArray(order.customers) ? order.customers[0] : order.customers;
      const custEmail = cust?.email || order.raw_payload?.customer?.email || order.raw_payload?.email || order.raw_payload?.contact_email || '';
      const custNome = cust?.nome || (order.raw_payload?.customer ? `${order.raw_payload.customer.first_name || ''} ${order.raw_payload.customer.last_name || ''}`.trim() : 'Cliente');
      const custObj = { nome: custNome, email: custEmail };

      let trk  = Array.isArray(order.trackings) ? order.trackings[0] : order.trackings;
      const addr = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;

      // Se o pedido não tiver um rastreamento criado no banco, gera um automaticamente
      if (!trk || !trk.codigo_rastreio) {
        const numClean = String(order.numero_pedido || '').replace(/\D/g, '');
        const novoCodigo = `BR${numClean.padStart(8, '0')}SP`;
        const { data: newTrk } = await supabaseAdmin.from('trackings').insert({
          order_id: order.id,
          codigo_rastreio: novoCodigo,
          status: 'postado',
          email_enviado: false,
          shopify_synced: false,
          historico: [{
            status: 'postado',
            data: new Date().toISOString(),
            descricao: 'Pedido confirmado e em preparação para envio.',
            local: 'Centro de Distribuição',
          }],
        }).select().single();

        if (newTrk) {
          trk = newTrk;
        } else {
          trk = { id: null, codigo_rastreio: novoCodigo, status: 'postado', email_enviado: false, shopify_synced: false };
        }
      }

      const notaJaEnviada     = order.raw_payload?.nota_enviada === true;
      const rastreioJaEnviado  = trk?.email_enviado === true;
      const criadoEmDiaAnterior = isAnteriorAHoje(order.created_at);

      const podeEnviarNota = !notaJaEnviada && (isManualTrigger || passouDelayHoras(order.created_at, notaDelayHoras));
      const podeEnviarRastreio = !rastreioJaEnviado && criadoEmDiaAnterior && notaJaEnviada;

      // Extrair método de envio do raw_payload
      const shippingMethod = order.raw_payload?.shipping_lines?.[0]?.title || null;

      try {
        const storeInfo: any = order.store_id ? storesMap.get(order.store_id) : null;
        const lojaNomeEspecifico = storeInfo?.empresa_nome || storeInfo?.nome_loja || empresaNome;

        // ── Envio de Rastreio ───────────────────────────────────
        if ((tipo === 'rastreio' || tipo === 'ambos') && podeEnviarRastreio && trk?.codigo_rastreio) {
          const trackingUrl = `${appUrl}/rastreio/${trk.codigo_rastreio}`;
          const htmlRastreio = buildRastreioHtml({ order, cust: custObj, trk, trackingUrl, empresaNome: lojaNomeEspecifico, storeInfo });

          if (resendApiKey) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: fromEmail,
                to: custObj.email,
                subject: `Código de Rastreio — Pedido #${order.numero_pedido}`,
                html: htmlRastreio,
              }),
            });
          }

          // Fulfilment na Shopify com carrier detectado e storeId
          let shopifyFulfilled = false;
          if (order.shopify_order_id) {
            shopifyFulfilled = await enviarRastreioShopify(
              Number(order.shopify_order_id),
              trk.codigo_rastreio,
              shippingMethod,
              order.store_id
            );
          }

          if (trk?.id) {
            await supabaseAdmin.from('trackings').update({
              email_enviado: true,
              email_enviado_em: new Date().toISOString(),
              shopify_synced: shopifyFulfilled,
            }).eq('id', trk.id);
          }
        }

        // ── Envio de Nota de Compra ─────────────────────────────
        if ((tipo === 'nota' || tipo === 'ambos') && podeEnviarNota) {
          const htmlNota = buildNotaHtml({ order, cust: custObj, addr, cfg, storeInfo });

          if (resendApiKey) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: fromEmail,
                to: custObj.email,
                subject: `Comprovante de Compra — Pedido #${order.numero_pedido}`,
                html: htmlNota,
              }),
            });
          }

          await supabaseAdmin.from('orders').update({
            raw_payload: {
              ...(order as any).raw_payload,
              nota_enviada: true,
              nota_enviada_em: new Date().toISOString(),
            },
          }).eq('id', order.id);
        }

        disparados++;
      } catch {
        erros++;
      }
    }

    return NextResponse.json({
      success: true,
      totalEncontrados: orders.length,
      totalAlvo: targetOrders.length,
      disparados,
      pulados,
      erros,
      periodo: periodo || 'todos',
      tipoNotificacao: tipo,
      regras: {
        notaDelayHoras,
        rastreioProximoDiaUtil,
      },
    });
  } catch (err: any) {
    console.error('Erro no disparo em lote:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}

// ── Templates HTML ─────────────────────────────────────────────────
function buildNotaHtml({ order, cust, addr, cfg, storeInfo }: any) {
  const empresaNome = storeInfo?.empresa_nome || storeInfo?.nome_loja || cfg['EMPRESA_NOME'] || 'Nossa Loja';
  const empresaCnpj = storeInfo?.empresa_cnpj || cfg['EMPRESA_CNPJ'] || '00.000.000/0001-00';
  const empresaEndereco = storeInfo?.empresa_endereco || cfg['EMPRESA_ENDERECO'] || 'Rua Principal, 100';
  const empresaCidade = storeInfo?.empresa_cidade || cfg['EMPRESA_CIDADE'] || 'São Paulo';
  const empresaEstado = storeInfo?.empresa_estado || cfg['EMPRESA_ESTADO'] || 'SP';
  const empresaCep = storeInfo?.empresa_cep || cfg['EMPRESA_CEP'] || '01000-000';
  const logoUrl = storeInfo?.logo_url || null;

  const dataPedido = order.created_at 
    ? new Date(order.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleDateString('pt-BR');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<style>
  body { margin:0; padding:0; background:#f4f6f8; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color:#333; }
  .wrapper { width:100%; table-layout:fixed; background-color:#f4f6f8; padding:40px 0; }
  .content-table { width:600px; margin:0 auto; background:#ffffff; border-radius:8px; border:1px solid #e1e4e6; overflow:hidden; border-collapse:collapse; }
  .header { background:#0f172a; padding:30px 40px; color:#ffffff; }
  .header h1 { margin:0; font-size:22px; font-weight:700; letter-spacing:-0.5px; }
  .header p { margin:5px 0 0; font-size:12px; color:#94a3b8; }
  .section { padding:30px 40px; border-bottom:1px solid #f0f2f4; }
  .section-title { font-size:12px; font-weight:700; text-transform:uppercase; color:#64748b; letter-spacing:1px; margin-bottom:15px; }
  .grid-table { width:100%; border-collapse:collapse; }
  .grid-table td { padding:4px 0; font-size:13px; color:#475569; vertical-align:top; }
  .items-table { width:100%; border-collapse:collapse; margin-top:10px; }
  .items-table th { border-bottom:2px solid #e2e8f0; padding:10px 0; text-align:left; font-size:11px; text-transform:uppercase; color:#64748b; font-weight:700; }
  .items-table td { border-bottom:1px solid #f1f5f9; padding:12px 0; font-size:13px; color:#1e293b; }
  .total-row { padding-top:20px; font-size:16px; font-weight:700; color:#0f172a; text-align:right; }
  .footer { background:#fafbfc; padding:20px 40px; text-align:center; font-size:11px; color:#94a3b8; border-top:1px solid #f0f2f4; }
</style>
</head>
<body>
<table class="wrapper" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center">
<table class="content-table" width="600" cellpadding="0" cellspacing="0">
  
  <!-- Header -->
  <tr><td class="header">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <h1>COMPROVANTE DE VENDA</h1>
          <p>Pedido #${order.numero_pedido} &bull; ${dataPedido}</p>
        </td>
        <td align="right" style="font-size:14px; font-weight:bold; color:#38bdf8;">
          NÃO POSSUI VALOR FISCAL
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Dados do Emitente (Empresa) -->
  <tr><td class="section">
    <div class="section-title">Dados do Emitente</div>
    <table class="grid-table">
      <tr>
        <td style="font-weight:bold; color:#1e293b; font-size:14px;" colspan="2">${empresaNome}</td>
      </tr>
      <tr>
        <td width="50%"><strong>CNPJ:</strong> ${empresaCnpj}</td>
        <td width="50%"><strong>Endereço:</strong> ${empresaEndereco}</td>
      </tr>
      <tr>
        <td><strong>Cidade/UF:</strong> ${empresaCidade} - ${empresaEstado}</td>
        <td><strong>CEP:</strong> ${empresaCep}</td>
      </tr>
    </table>
  </td></tr>

  <!-- Dados do Destinatário (Cliente) -->
  <tr><td class="section">
    <div class="section-title">Dados do Destinatário</div>
    <table class="grid-table">
      <tr>
        <td width="50%"><strong>Nome:</strong> ${cust?.nome || 'Cliente'}</td>
        <td width="50%"><strong>E-mail:</strong> ${cust?.email || '—'}</td>
      </tr>
      ${addr ? `
      <tr>
        <td colspan="2"><strong>Endereço de Entrega:</strong> ${addr.logradouro || ''}, ${addr.numero || ''} ${addr.complemento || ''} - ${addr.bairro || ''} - ${addr.cidade || ''}/${addr.estado || ''} - CEP: ${addr.cep || ''}</td>
      </tr>
      ` : ''}
    </table>
  </td></tr>

  <!-- Detalhes do Pedido (Itens) -->
  <tr><td class="section">
    <div class="section-title">Itens do Pedido</div>
    <table class="items-table">
      <thead>
        <tr>
          <th width="65%">Produto</th>
          <th width="15%" style="text-align:center;">Qtd</th>
          <th width="20%" style="text-align:right;">Preço</th>
        </tr>
      </thead>
      <tbody>
        ${(order.itens || []).map((item: any) => `
        <tr>
          <td>
            <div style="font-weight:600; color:#0f172a;">${item.title}</div>
            ${item.sku ? `<div style="font-size:10px; color:#64748b; margin-top:2px;">SKU: ${item.sku}</div>` : ''}
          </td>
          <td style="text-align:center;">${item.quantity}</td>
          <td style="text-align:right; font-weight:500;">R$ ${parseFloat(item.price).toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    
    <div class="total-row">
      Total Geral: R$ ${(order.valor_total || 0).toFixed(2)}
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td class="footer">
    <p>Este documento é um comprovante de compra gerado de forma automática por Rastreio.IO.<br/>
    Dúvidas ou suporte? Entre em contato respondendo a este e-mail.</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function buildRastreioHtml({ order, cust, trk, trackingUrl, empresaNome }: any) {
  const firstName = (cust?.nome || 'Cliente').split(' ')[0];
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
<tr><td align="center">
<table width="600" style="max-width:600px;width:100%;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
  <tr><td style="background:linear-gradient(90deg,#6366f1,#8b5cf6);height:4px;"></td></tr>
  <tr><td style="padding:32px;">
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">${firstName}</strong> 👋</p>
    <h1 style="color:#f1f5f9;font-size:24px;margin:0 0 8px;">Seu pedido está a caminho! 📦</h1>
    <p style="color:#64748b;font-size:13px;margin:0 0 28px;">Pedido <strong style="color:#94a3b8;">#${order.numero_pedido}</strong> foi enviado e já pode ser rastreado.</p>
    <div style="background:#0f172a;border-radius:12px;border:1px solid #334155;padding:18px 22px;margin-bottom:24px;">
      <p style="color:#64748b;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Código de Rastreio</p>
      <p style="color:#818cf8;font-size:22px;font-weight:800;font-family:'Courier New',monospace;margin:0;letter-spacing:2px;">${trk.codigo_rastreio}</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <a href="${trackingUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 36px;border-radius:10px;">
          🔍 Rastrear meu pedido
        </a>
      </td></tr>
    </table>
    <p style="color:#475569;font-size:11px;text-align:center;margin-top:16px;">
      Ou acesse: <a href="${trackingUrl}" style="color:#6366f1;">${trackingUrl}</a>
    </p>
  </td></tr>
  <tr><td style="padding:16px 32px;text-align:center;">
    <p style="color:#475569;font-size:11px;margin:0;">${empresaNome} · Obrigado pela compra! 🙏</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
