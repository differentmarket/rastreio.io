import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';
import { enviarRastreioShopify } from '@/lib/shopifyService';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const tipo = body.tipo || 'ambos'; // 'rastreio' | 'nota' | 'ambos'
    const force = body.force || false; // Se true, ignora trava de duplicidade

    // Busca detalhes do pedido, cliente, endereco e tracking
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        shopify_order_id,
        numero_pedido,
        valor_total,
        itens,
        created_at,
        customers (
          nome,
          email,
          telefone
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
          email_enviado_em,
          shopify_synced
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error || !order) {
      return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    }

    const customer: any = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    const tracking: any = Array.isArray(order.trackings) ? order.trackings[0] : order.trackings;
    const address: any = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;

    if (!customer?.email) {
      return NextResponse.json({ error: 'Cliente não possui e-mail cadastrado.' }, { status: 400 });
    }

    const resendApiKey = process.env.RESEND_API_KEY || '';
    const resendFromEmail = process.env.RESEND_FROM_EMAIL || 'notificacoes@resend.dev';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';

    let enviouRastreio = false;
    let enviouNota = false;
    let shopifyFulfilled = false;

    const empresaNome = process.env.EMPRESA_NOME || 'Minha Loja';

    // 1. Processar Envio do Rastreio
    if (tipo === 'rastreio' || tipo === 'ambos') {
      if (!tracking?.codigo_rastreio) {
        if (tipo === 'rastreio') {
          return NextResponse.json({ error: 'Pedido não possui código de rastreamento gerado.' }, { status: 400 });
        }
      } else {
        // Checagem de Trava de Duplicidade para Rastreio
        if (tracking.email_enviado && !force) {
          if (tipo === 'rastreio') {
            return NextResponse.json({ error: 'E-mail de rastreamento já foi enviado anteriormente para este pedido.' }, { status: 409 });
          }
        } else {
          const trackingUrl = `${appUrl}/rastreio/${tracking.codigo_rastreio}`;
          const htmlRastreio = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1e293b;">
              <h2 style="color: #4f46e5; margin-top: 0;">Seu pedido #${order.numero_pedido} está a caminho! 📦</h2>
              <p>Olá <strong>${customer.nome}</strong>,</p>
              <p>Seu código de rastreamento oficial é: <b style="font-size: 18px; color: #10b981; font-family: monospace;">${tracking.codigo_rastreio}</b></p>
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
                to: customer.email,
                subject: `Código de Rastreio - Pedido #${order.numero_pedido}`,
                html: htmlRastreio,
              }),
            });
          }

          enviouRastreio = true;

          // Atualizar Shopify Fulfillment
          if (order.shopify_order_id) {
            shopifyFulfilled = await enviarRastreioShopify(Number(order.shopify_order_id), tracking.codigo_rastreio);
          }

          // Gravar status no banco
          if (tracking.id) {
            await supabaseAdmin.from('trackings').update({
              email_enviado: true,
              email_enviado_em: new Date().toISOString(),
              shopify_synced: shopifyFulfilled,
            }).eq('id', tracking.id);
          }
        }
      }
    }

    // 2. Processar Envio da Nota de Compra
    if (tipo === 'nota' || tipo === 'ambos') {
      const htmlNota = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1e293b;">
          <h2 style="color: #0f172a; margin-top: 0;">Comprovante de Compra - Pedido #${order.numero_pedido} 🧾</h2>
          <p>Olá <strong>${customer.nome}</strong>,</p>
          <p>Agradecemos pela sua compra na <strong>${empresaNome}</strong>! Aqui estão os detalhes do seu pedido:</p>
          
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

          ${address ? `
            <div style="margin-top: 20px; padding: 12px; background-color: #f8fafc; border-radius: 8px; font-size: 13px;">
              <strong>Endereço de Entrega:</strong><br />
              ${address.logradouro || ''}, ${address.numero || ''} ${address.complemento || ''}<br />
              ${address.bairro || ''} - ${address.cidade || ''}/${address.estado || ''} - CEP: ${address.cep || ''}
            </div>
          ` : ''}

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">Obrigado por comprar conosco! Equipe ${empresaNome}</p>
        </div>
      `;

      if (resendApiKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: resendFromEmail,
            to: customer.email,
            subject: `Comprovante de Compra - Pedido #${order.numero_pedido}`,
            html: htmlNota,
          }),
        });
      }

      enviouNota = true;

      // Grava flag de nota enviada no pedido
      await supabaseAdmin.from('orders').update({
        raw_payload: {
          ...(order as any).raw_payload,
          nota_enviada: true,
          nota_enviada_em: new Date().toISOString(),
        }
      }).eq('id', order.id);
    }

    return NextResponse.json({
      success: true,
      tipo,
      enviouRastreio,
      enviouNota,
      shopifyFulfilled,
      message: 'Notificação processada com sucesso.',
    });
  } catch (err: any) {
    console.error('Erro ao enviar notificação:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
