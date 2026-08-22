import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enviarRastreioShopify } from '@/lib/shopifyService';

export const dynamic = 'force-dynamic';

function getStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isAnteriorAHoje(orderCreatedAt: string): boolean {
  const orderDay = getStartOfDay(new Date(orderCreatedAt));
  const todayDay = getStartOfDay(new Date());
  return orderDay < todayDay;
}

export async function GET(req: NextRequest) {
  try {
    const agoraIso = new Date().toISOString();

    // 1. Carregar configurações gerais do banco
    const { data: settings } = await supabaseAdmin.from('settings').select('key, value');
    const cfg: Record<string, string> = {};
    settings?.forEach(s => { cfg[s.key] = s.value; });

    // 2. Carregar mapa de todas as lojas para isolamento de dados fiscais (Multi-Tenant)
    const { data: storesList } = await supabaseAdmin.from('stores').select('*');
    const storesMap = new Map<string, any>((storesList || []).map(s => [s.id, s]));

    const resendApiKey = cfg['RESEND_API_KEY'] || process.env.RESEND_API_KEY || '';
    let fromEmail = cfg['RESEND_FROM_EMAIL'] || process.env.RESEND_FROM_EMAIL || 'Rastreio <onboarding@resend.dev>';
    if (fromEmail.includes('seudominio.com')) {
      fromEmail = 'Rastreio <onboarding@resend.dev>';
    }
    let rawAppUrl = cfg['NEXT_PUBLIC_APP_URL'] || process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
    rawAppUrl = rawAppUrl.trim().replace(/\/+$/, '').replace(/\/rastreio$/, '');
    if (!rawAppUrl || rawAppUrl.includes('localhost') || rawAppUrl.includes('ri7o2sjad')) {
      rawAppUrl = 'https://rastreio-io.vercel.app';
    }
    const appUrl = rawAppUrl;
    const empresaNome = cfg['EMPRESA_NOME'] || 'Nossa Loja';

    const resultadosNotas: any[] = [];
    const resultadosRastreios: any[] = [];

    // -----------------------------------------------------------------
    // PARTE 1: Processar Envios Automáticos de NOTA FISCAL (Comprovante)
    // -----------------------------------------------------------------
    const { data: pendingNotaOrders, error: notaErr } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        store_id,
        numero_pedido,
        valor_total,
        itens,
        created_at,
        raw_payload,
        customers ( nome, email, telefone ),
        addresses ( logradouro, numero, complemento, bairro, cidade, estado, cep )
      `)
      .eq('status_pedido', 'pago');

    if (notaErr) {
      console.error('Erro ao buscar pedidos para envio de nota fiscal:', notaErr);
    } else if (pendingNotaOrders && pendingNotaOrders.length > 0) {
      const notaDelayHoras = parseFloat(cfg['NOTA_DELAY_HORAS'] || '2');

      for (const order of pendingNotaOrders) {
        const rawPayload = (order.raw_payload as any) || {};
        const enviarNotaEm = rawPayload.enviar_nota_em;
        const notaEnviada = rawPayload.nota_enviada === true;

        const criadoEmMs = new Date(order.created_at).getTime();
        const agoraMs = Date.now();
        const passouDelayCriacao = (agoraMs - criadoEmMs) >= (notaDelayHoras * 3600 * 1000);

        // Se o prazo explícito enviar_nota_em venceu, OU se já passaram X horas da criação do pedido sem enviar a nota
        const prazoNotaPassou = (enviarNotaEm && new Date(enviarNotaEm).getTime() <= agoraMs) || (!enviarNotaEm && passouDelayCriacao) || passouDelayCriacao;

        if (prazoNotaPassou && !notaEnviada) {
          const customer: any = Array.isArray(order.customers) ? order.customers[0] : order.customers;
          const address: any = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;
          const storeInfo: any = order.store_id ? storesMap.get(order.store_id) : null;

          if (customer?.email) {
            try {
              const htmlNota = buildNotaHtml({ order, cust: customer, addr: address, cfg, storeInfo });

              if (resendApiKey) {
                const r = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    from: fromEmail,
                    to: customer.email,
                    subject: `Comprovante de Compra — Pedido #${order.numero_pedido}`,
                    html: htmlNota,
                  }),
                });

                if (!r.ok) {
                  const rData = await r.json().catch(() => ({}));
                  throw new Error(rData.message || 'Falha ao enviar e-mail via Resend.');
                }
              }

              // Atualizar flag de nota enviada no raw_payload
              await supabaseAdmin.from('orders').update({
                raw_payload: {
                  ...rawPayload,
                  nota_enviada: true,
                  nota_enviada_em: new Date().toISOString(),
                },
              }).eq('id', order.id);

              resultadosNotas.push({ order: order.numero_pedido, email: customer.email, status: 'enviado' });
            } catch (err: any) {
              console.error(`Erro ao enviar Nota Fiscal do pedido #${order.numero_pedido}:`, err);
              resultadosNotas.push({ order: order.numero_pedido, status: 'erro', erro: err.message });
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------
    // PARTE 2: Processar Envios Automáticos de RASTREIO no Próximo Dia Útil
    // -----------------------------------------------------------------
    const { data: trackings, error: trackErr } = await supabaseAdmin
      .from('trackings')
      .select(`
        id,
        codigo_rastreio,
        order_id,
        shopify_synced,
        email_enviado,
        sync_after,
        orders (
          id,
          store_id,
          shopify_order_id,
          numero_pedido,
          created_at,
          raw_payload,
          customers ( nome, email )
        )
      `)
      .lte('sync_after', agoraIso);

    if (trackErr) {
      console.error('Erro ao buscar rastreamentos agendados:', trackErr);
    } else if (trackings && trackings.length > 0) {
      for (const tracking of trackings) {
        const orderObj: any = Array.isArray(tracking.orders) ? tracking.orders[0] : tracking.orders;
        const customer: any = orderObj?.customers ? (Array.isArray(orderObj.customers) ? orderObj.customers[0] : orderObj.customers) : null;
        const shopifyOrderId = orderObj?.shopify_order_id;

        let emailSucesso = tracking.email_enviado;
        let shopifySucesso = tracking.shopify_synced;

        const notaJaEnviada = orderObj?.raw_payload?.nota_enviada === true;
        const criadoEmDiaAnterior = orderObj?.created_at ? isAnteriorAHoje(orderObj.created_at) : false;

        // REGRA 1: Não pode enviar rastreio no mesmo dia da compra
        // REGRA 2: Não pode enviar rastreio sem a Nota Fiscal ter sido enviada previamente
        if (!criadoEmDiaAnterior || !notaJaEnviada) {
          console.log(`[BLOQUEIO REGRAS] Pedido #${orderObj?.numero_pedido} não elegível para rastreio. Dia Anterior: ${criadoEmDiaAnterior}, Nota Enviada: ${notaJaEnviada}`);
          continue;
        }

        // 1. Enviar e-mail de rastreio ao cliente se ainda não foi enviado
        if (!tracking.email_enviado && customer?.email && orderObj) {
          try {
            const storeInfo: any = orderObj.store_id ? storesMap.get(orderObj.store_id) : null;
            const lojaNomeEspecifico = storeInfo?.empresa_nome || storeInfo?.nome_loja || empresaNome;
            const trackingUrl = `${appUrl}/rastreio/${tracking.codigo_rastreio}`;
            const htmlRastreio = buildRastreioHtml({ order: orderObj, cust: customer, trk: tracking, trackingUrl, empresaNome: lojaNomeEspecifico, storeInfo });

            if (resendApiKey) {
              const r = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${resendApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: fromEmail,
                  to: customer.email,
                  subject: `Pedido #${orderObj.numero_pedido} — Código de Rastreio`,
                  html: htmlRastreio,
                }),
              });

              if (!r.ok) {
                const rData = await r.json().catch(() => ({}));
                throw new Error(rData.message || 'Falha ao enviar e-mail via Resend.');
              }
            }

            emailSucesso = true;
          } catch (err: any) {
            console.error(`Erro ao enviar e-mail de rastreio ${tracking.codigo_rastreio}:`, err);
          }
        }

        // 2. Sincronizar Fulfillment na Shopify se ainda não sincronizou
        if (!tracking.shopify_synced && shopifyOrderId) {
          try {
            const rawPayload = orderObj?.raw_payload || {};
            const shippingLines = rawPayload.shipping_lines || [];
            const shippingMethod = shippingLines[0]?.title || null;
            shopifySucesso = await enviarRastreioShopify(Number(shopifyOrderId), tracking.codigo_rastreio, shippingMethod, orderObj.store_id);
          } catch (shopifyErr: any) {
            console.error(`Erro ao sincronizar fulfillment na Shopify para rastreio ${tracking.codigo_rastreio}:`, shopifyErr);
          }
        }

        // Atualizar status no banco
        if (emailSucesso !== tracking.email_enviado || shopifySucesso !== tracking.shopify_synced) {
          await supabaseAdmin
            .from('trackings')
            .update({
              email_enviado: emailSucesso,
              email_enviado_em: emailSucesso ? new Date().toISOString() : undefined,
              shopify_synced: shopifySucesso,
            })
            .eq('id', tracking.id);

          resultadosRastreios.push({
            codigo: tracking.codigo_rastreio,
            emailEnviado: emailSucesso,
            shopifySynced: shopifySucesso,
          });
        }
      }
    }

    // -----------------------------------------------------------------
    // PARTE 3: Processar Disparos de RECUPERAÇÃO DE VENDAS via WhatsApp (IA)
    // -----------------------------------------------------------------
    const resultadosRecuperacao: any[] = [];
    const { data: pendingConversations, error: convErr } = await supabaseAdmin
      .from('ai_recovery_conversations')
      .select('id, store_id, order_id, customer_phone, customer_name, valor_pedido, agendado_para, orders(numero_pedido, status_pedido)')
      .eq('status', 'pendente_envio')
      .lte('agendado_para', agoraIso);

    if (convErr) {
      console.error('Erro ao buscar recuperações de IA agendadas:', convErr);
    } else if (pendingConversations && pendingConversations.length > 0) {
      for (const conv of pendingConversations) {
        const orderObj: any = Array.isArray(conv.orders) ? conv.orders[0] : conv.orders;
        const statusPedido = orderObj?.status_pedido || 'pendente';
        const numPedido = orderObj?.numero_pedido || '';

        // Se o pedido foi pago entre o agendamento e o disparo, cancela o disparo
        if (statusPedido === 'pago') {
          await supabaseAdmin
            .from('ai_recovery_conversations')
            .update({ status: 'cancelado_ja_pago' })
            .eq('id', conv.id);
          resultadosRecuperacao.push({ id: conv.id, status: 'cancelado_ja_pago' });
          continue;
        }

        // Buscar dados da loja para Evolution API
        let { data: store } = await supabaseAdmin
          .from('stores')
          .select('nome_loja, evolution_api_url, evolution_api_key, evolution_instance_name, ai_recovery_enabled')
          .eq('id', conv.store_id)
          .maybeSingle();

        if (!store) {
          const { data: defaultStore } = await supabaseAdmin.from('stores').select('*').eq('status', 'ativa').limit(1).maybeSingle();
          store = defaultStore;
        }

        const apiUrl = store?.evolution_api_url || process.env.EVOLUTION_API_URL;
        const apiSecret = store?.evolution_api_key || process.env.EVOLUTION_API_KEY;
        const instName = store?.evolution_instance_name || process.env.EVOLUTION_INSTANCE_NAME;

        const customerFirstName = (conv.customer_name || 'Cliente').split(' ')[0];
        const storeName = store?.nome_loja || empresaNome;

        const initialMsg = `Olá ${customerFirstName}! 🛒 Vi que você gerou o pedido #${numPedido} na ${storeName}, mas o pagamento não foi concluído. Precisa de ajuda com o Pix ou Cartão? Estamos à disposição!`;

        let enviouWa = false;

        if (apiUrl && apiSecret && instName && conv.customer_phone) {
          try {
            const waRes = await fetch(`${apiUrl.replace(/\/$/, '')}/message/sendText/${instName}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': apiSecret,
              },
              body: JSON.stringify({
                number: conv.customer_phone,
                text: initialMsg,
                delay: 1000,
              }),
            });
            if (waRes.ok) enviouWa = true;
          } catch (errWa: any) {
            console.error(`Erro ao enviar mensagem no WhatsApp para ${conv.customer_phone}:`, errWa);
          }
        }

        // Atualizar a conversa para em_andamento
        const initialMensagens = [
          { sender: 'ai', text: initialMsg, timestamp: new Date().toISOString() }
        ];

        await supabaseAdmin
          .from('ai_recovery_conversations')
          .update({
            status: 'em_andamento',
            mensagens: initialMensagens,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conv.id);

        resultadosRecuperacao.push({
          id: conv.id,
          phone: conv.customer_phone,
          pedido: numPedido,
          enviouWa,
          status: 'em_andamento',
        });
      }
    }

    return NextResponse.json({
      message: 'Processamento de automações agendadas concluído.',
      agora: agoraIso,
      notasFiscaisProcessadas: resultadosNotas,
      rastreiosProcessados: resultadosRastreios,
      recuperacoesProcessadas: resultadosRecuperacao,
    });
  } catch (err: any) {
    console.error('Erro geral no cron job de automações:', err);
    return NextResponse.json({ error: err.message || 'Erro Interno' }, { status: 500 });
  }
}

// ── Templates HTML Auxiliares ──────────────────────────────────────────────

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
    <p style="color:#64748b;font-size:13px;margin:0 0 28px;">Pedido <strong style="color:#94a3b8;">#${order.numero_pedido}</strong></p>
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
  </td></tr>
  <tr><td style="padding:16px 32px;text-align:center;">
    <p style="color:#475569;font-size:11px;margin:0;">${empresaNome} · E-mail enviado por Rastreio.IO</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
