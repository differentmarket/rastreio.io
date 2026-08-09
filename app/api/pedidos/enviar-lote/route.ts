import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';
import { enviarRastreioShopify } from '@/lib/shopifyService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { periodo, tipoNotificacao } = body; // periodo: 'hoje' | 'ontem' | 'semana' | 'mes' | 'pendentes' | 'todos'
    const tipo = tipoNotificacao || 'ambos'; // 'rastreio' | 'nota' | 'ambos'

    let query = supabaseAdmin.from('orders').select(`
      id,
      shopify_order_id,
      numero_pedido,
      status_pedido,
      valor_total,
      itens,
      raw_payload,
      created_at,
      customers (
        nome,
        email
      ),
      addresses (
        logradouro,
        numero,
        complemento,
        bairro,
        cidade,
        estado,
        cep
      ),
      trackings (
        id,
        codigo_rastreio,
        status,
        email_enviado,
        shopify_synced
      )
    `);

    const now = new Date();
    if (periodo === 'hoje') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      query = query.gte('created_at', todayStart);
    } else if (periodo === 'ontem') {
      const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      query = query.gte('created_at', yesterdayStart).lt('created_at', todayStart);
    } else if (periodo === 'semana') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', weekAgo);
    } else if (periodo === 'mes') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      query = query.gte('created_at', monthStart);
    }

    const { data: orders, error } = await query;

    if (error || !orders) {
      return NextResponse.json({ error: 'Erro ao buscar pedidos para disparo em lote.' }, { status: 500 });
    }

    // Filtrar apenas pedidos elegíveis (que possuem e-mail e não foram disparados previamente do mesmo tipo)
    const targetOrders = orders.filter((o: any) => {
      const cust = Array.isArray(o.customers) ? o.customers[0] : o.customers;
      const trk = Array.isArray(o.trackings) ? o.trackings[0] : o.trackings;

      if (!cust?.email) return false;

      const notaJaEnviada = o.raw_payload?.nota_enviada === true;
      const rastreioJaEnviado = trk?.email_enviado === true;

      if (periodo === 'pendentes') {
        if (tipo === 'rastreio') return !rastreioJaEnviado && trk?.codigo_rastreio;
        if (tipo === 'nota') return !notaJaEnviada;
        return !rastreioJaEnviado || !notaJaEnviada;
      }

      // Prevenção de duplicidade: só envia o que ainda não foi enviado
      if (tipo === 'rastreio') return !rastreioJaEnviado && trk?.codigo_rastreio;
      if (tipo === 'nota') return !notaJaEnviada;
      return (!rastreioJaEnviado && trk?.codigo_rastreio) || !notaJaEnviada;
    });

    const resendApiKey = process.env.RESEND_API_KEY || '';
    const resendFromEmail = process.env.RESEND_FROM_EMAIL || 'notificacoes@resend.dev';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
    const empresaNome = process.env.EMPRESA_NOME || 'Minha Loja';

    let disparados = 0;
    let pulados = orders.length - targetOrders.length;
    let erros = 0;

    for (const order of targetOrders) {
      const cust = Array.isArray(order.customers) ? order.customers[0] : order.customers;
      const trk = Array.isArray(order.trackings) ? order.trackings[0] : order.trackings;
      const addr = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;

      const notaJaEnviada = order.raw_payload?.nota_enviada === true;
      const rastreioJaEnviado = trk?.email_enviado === true;

      try {
        // Envio de Rastreio
        if ((tipo === 'rastreio' || tipo === 'ambos') && !rastreioJaEnviado && trk?.codigo_rastreio) {
          const trackingUrl = `${appUrl}/rastreio/${trk.codigo_rastreio}`;
          const htmlRastreio = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1e293b;">
              <h2 style="color: #4f46e5; margin-top: 0;">Seu pedido #${order.numero_pedido} está a caminho! 📦</h2>
              <p>Olá <strong>${cust.nome}</strong>,</p>
              <p>Seu código de rastreamento oficial é: <b style="font-size: 18px; color: #10b981; font-family: monospace;">${trk.codigo_rastreio}</b></p>
              <p>Acompanhe a movimentação da sua encomenda em tempo real clicando no botão abaixo:</p>
              <div style="margin: 24px 0;">
                <a href="${trackingUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Rastrear Minha Encomenda</a>
              </div>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">Equipe ${empresaNome}</p>
            </div>
          `;

          if (resendApiKey) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: resendFromEmail,
                to: cust.email,
                subject: `Código de Rastreio - Pedido #${order.numero_pedido}`,
                html: htmlRastreio,
              }),
            });
          }

          let shopifyFulfilled = false;
          if (order.shopify_order_id) {
            shopifyFulfilled = await enviarRastreioShopify(Number(order.shopify_order_id), trk.codigo_rastreio);
          }

          if (trk?.id) {
            await supabaseAdmin.from('trackings').update({
              email_enviado: true,
              email_enviado_em: new Date().toISOString(),
              shopify_synced: shopifyFulfilled,
            }).eq('id', trk.id);
          }
        }

        // Envio de Nota de Compra
        if ((tipo === 'nota' || tipo === 'ambos') && !notaJaEnviada) {
          const htmlNota = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1e293b;">
              <h2 style="color: #0f172a; margin-top: 0;">Comprovante de Compra - Pedido #${order.numero_pedido} 🧾</h2>
              <p>Olá <strong>${cust.nome}</strong>,</p>
              <p>Agradecemos pela sua compra na <strong>${empresaNome}</strong>! Confira os detalhes do seu pedido:</p>
              
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
                <thead>
                  <tr style="border-bottom: 2px solid #e2e8f0; text-align: left;">
                    <th style="padding: 8px 0;">Item</th>
                    <th style="padding: 8px 0; text-align: center;">Qtd</th>
                    <th style="padding: 8px 0; text-align: right;">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  ${(order.itens || []).map((item: any) => `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                      <td style="padding: 8px 0;">${item.title}</td>
                      <td style="padding: 8px 0; text-align: center;">${item.quantity}</td>
                      <td style="padding: 8px 0; text-align: right;">R$ ${parseFloat(item.price).toFixed(2)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <div style="text-align: right; font-size: 16px; font-weight: bold; color: #0f172a; margin-top: 15px;">
                Total Pago: R$ ${(order.valor_total || 0).toFixed(2)}
              </div>

              ${addr ? `
                <div style="margin-top: 20px; padding: 12px; background-color: #f8fafc; border-radius: 8px; font-size: 13px;">
                  <strong>Endereço de Entrega:</strong><br />
                  ${addr.logradouro || ''}, ${addr.numero || ''} ${addr.complemento || ''}<br />
                  ${addr.bairro || ''} - ${addr.cidade || ''}/${addr.estado || ''} - CEP: ${addr.cep || ''}
                </div>
              ` : ''}

              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">Equipe ${empresaNome}</p>
            </div>
          `;

          if (resendApiKey) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: resendFromEmail,
                to: cust.email,
                subject: `Comprovante de Compra - Pedido #${order.numero_pedido}`,
                html: htmlNota,
              }),
            });
          }

          await supabaseAdmin.from('orders').update({
            raw_payload: {
              ...(order as any).raw_payload,
              nota_enviada: true,
              nota_enviada_em: new Date().toISOString(),
            }
          }).eq('id', order.id);
        }

        disparados++;
      } catch (e) {
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
    });
  } catch (err: any) {
    console.error('Erro no disparo em lote:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
