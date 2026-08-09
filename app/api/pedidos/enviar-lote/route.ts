import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';
import { getShopifyConfig } from '@/lib/shopifyService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { periodo } = body; // 'hoje' | 'ontem' | 'semana' | 'pendentes' | 'todos'

    let query = supabaseAdmin.from('orders').select(`
      id,
      numero_pedido,
      status_pedido,
      created_at,
      customers (
        nome,
        email
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
    }

    const { data: orders, error } = await query;

    if (error || !orders) {
      return NextResponse.json({ error: 'Erro ao buscar pedidos para disparo.' }, { status: 500 });
    }

    // Filtrar apenas pedidos que possuem tracking e cliente com e-mail
    let targetOrders = orders.filter((o: any) => {
      const trk = Array.isArray(o.trackings) ? o.trackings[0] : o.trackings;
      const cust = Array.isArray(o.customers) ? o.customers[0] : o.customers;
      if (!trk?.codigo_rastreio || !cust?.email) return false;

      if (periodo === 'pendentes') {
        return !trk.email_enviado;
      }
      return true;
    });

    const resendApiKey = process.env.RESEND_API_KEY || '';
    const resendFromEmail = process.env.RESEND_FROM_EMAIL || 'rastreio@resend.dev';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';

    let disparados = 0;
    let erros = 0;

    for (const order of targetOrders) {
      const trk = Array.isArray(order.trackings) ? order.trackings[0] : order.trackings;
      const cust = Array.isArray(order.customers) ? order.customers[0] : order.customers;

      const trackingUrl = `${appUrl}/rastreio/${trk.codigo_rastreio}`;
      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4f46e5;">Seu pedido #${order.numero_pedido} foi atualizado! 📦</h2>
          <p>Olá <strong>${cust.nome}</strong>,</p>
          <p>Seu código de rastreamento oficial é: <b style="font-size: 18px; color: #10b981;">${trk.codigo_rastreio}</b></p>
          <p>Acompanhe o status de entrega do seu pedido em tempo real:</p>
          <div style="margin: 25px 0;">
            <a href="${trackingUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Ver Status do Rastreio</a>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #666;">Se você tiver alguma dúvida, responda a este e-mail.</p>
        </div>
      `;

      try {
        if (resendApiKey) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: resendFromEmail,
              to: cust.email,
              subject: `Código de Rastreio - Pedido #${order.numero_pedido}`,
              html: emailHtml,
            }),
          });
        }

        // Marcar como enviado no banco
        if (trk?.id) {
          await supabaseAdmin.from('trackings').update({
            email_enviado: true,
            email_enviado_em: new Date().toISOString(),
          }).eq('id', trk.id);
        }

        disparados++;
      } catch (e) {
        erros++;
      }
    }

    return NextResponse.json({
      success: true,
      totalAlvo: targetOrders.length,
      disparados,
      erros,
      periodo: periodo || 'todos',
    });
  } catch (err: any) {
    console.error('Erro no disparo em lote:', err);
    return NextResponse.json({ error: err.message || 'Erro no servidor.' }, { status: 500 });
  }
}
