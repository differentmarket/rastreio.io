import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';
import { sendTrackingEmail } from '@/lib/email';
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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const isMock = supabaseUrl.includes('mock-project');

    // === MODO MOCK ===
    if (isMock) {
      const mockData: Record<string, {
        email: string; nome: string; numeroPedido: string;
        codigoRastreio: string; shopifyOrderId: number;
      }> = {
        'mock-order-1':      { email: 'carlos.silva@example.com',   nome: 'Carlos Silva',   numeroPedido: '1001', codigoRastreio: 'BR2607X8F3K9', shopifyOrderId: 1001 },
        'mock-order-2':      { email: 'maria.souza@example.com',    nome: 'Maria Souza',    numeroPedido: '1002', codigoRastreio: 'BR2607A3F9K1', shopifyOrderId: 1002 },
        'mock-order-3':      { email: 'joao.pereira@example.com',   nome: 'João Pereira',   numeroPedido: '1003', codigoRastreio: 'BR2607T4Y7P2', shopifyOrderId: 1003 },
        'mock-shopify-5001': { email: 'ana.lima@example.com',       nome: 'Ana Lima',       numeroPedido: '5001', codigoRastreio: 'BR0000005001SP', shopifyOrderId: 5001 },
        'mock-shopify-5002': { email: 'bruno.carvalho@example.com', nome: 'Bruno Carvalho', numeroPedido: '5002', codigoRastreio: 'BR0000005002SP', shopifyOrderId: 5002 },
        'mock-shopify-5003': { email: 'carla.mendes@example.com',   nome: 'Carla Mendes',   numeroPedido: '5003', codigoRastreio: 'BR0000005003SP', shopifyOrderId: 5003 },
        'mock-shopify-5004': { email: 'diego.fonseca@example.com',  nome: 'Diego Fonseca',  numeroPedido: '5004', codigoRastreio: 'BR0000005004SP', shopifyOrderId: 5004 },
        'mock-shopify-5005': { email: 'elisa.rocha@example.com',    nome: 'Elisa Rocha',    numeroPedido: '5005', codigoRastreio: 'BR0000005005SP', shopifyOrderId: 5005 },
      };

      const mock = mockData[id];
      if (!mock) {
        return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const trackingUrl = `${baseUrl}/rastreio/${mock.codigoRastreio}`;

      // 1. Envia o e-mail
      const emailResult = await sendTrackingEmail({
        toEmail: mock.email,
        toName: mock.nome,
        numeroPedido: mock.numeroPedido,
        codigoRastreio: mock.codigoRastreio,
        trackingUrl,
      });

      // 2. Cria Fulfillment na Shopify (mock loga no console)
      const shopifyResult = await enviarRastreioShopify(mock.shopifyOrderId, mock.codigoRastreio);

      return NextResponse.json({
        success: true,
        message: `E-mail enviado para ${mock.email}`,
        emailEnviado: emailResult.success,
        shopifyFulfilled: shopifyResult,
        emailError: emailResult.error,
      });
    }

    // === MODO PRODUÇÃO ===
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        shopify_order_id,
        numero_pedido,
        customers ( nome, email ),
        trackings ( id, codigo_rastreio, email_enviado )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar pedido para envio de e-mail:', error);
      return NextResponse.json({ error: 'Erro ao buscar dados do pedido.' }, { status: 500 });
    }

    if (!order) {
      return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    }

    const customer: any = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    const tracking: any = Array.isArray(order.trackings) ? order.trackings[0] : order.trackings;

    if (!customer?.email) {
      return NextResponse.json({ error: 'Cliente sem e-mail cadastrado.' }, { status: 422 });
    }
    if (!tracking?.codigo_rastreio) {
      return NextResponse.json({ error: 'Pedido sem código de rastreio cadastrado.' }, { status: 422 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const trackingUrl = `${baseUrl}/rastreio/${tracking.codigo_rastreio}`;

    // 1. Envia o e-mail via Resend
    const emailResult = await sendTrackingEmail({
      toEmail: customer.email,
      toName: customer.nome || 'Cliente',
      numeroPedido: order.numero_pedido,
      codigoRastreio: tracking.codigo_rastreio,
      trackingUrl,
    });

    // 2. Registra email_enviado no banco (mesmo se Shopify falhar)
    if (emailResult.success && tracking.id) {
      await supabaseAdmin
        .from('trackings')
        .update({
          email_enviado: true,
          email_enviado_em: new Date().toISOString(),
        })
        .eq('id', tracking.id);
    }

    // 3. Cria Fulfillment na Shopify
    let shopifyFulfilled = false;
    let shopifyError: string | undefined;

    if (emailResult.success) {
      shopifyFulfilled = await enviarRastreioShopify(order.shopify_order_id, tracking.codigo_rastreio);
      
      if (shopifyFulfilled && tracking.id) {
        await supabaseAdmin
          .from('trackings')
          .update({ shopify_synced: true })
          .eq('id', tracking.id);

        // Atualiza status do pedido para 'enviado'
        await supabaseAdmin
          .from('orders')
          .update({ status_pedido: 'enviado' })
          .eq('id', id);
      } else if (!shopifyFulfilled) {
        shopifyError = 'Fulfillment criado no e-mail mas falhou na Shopify. Verifique manualmente.';
      }
    }

    if (!emailResult.success) {
      return NextResponse.json({ error: emailResult.error || 'Falha ao enviar e-mail.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `E-mail enviado para ${customer.email}`,
      emailEnviado: true,
      shopifyFulfilled,
      shopifyError,
    });
  } catch (err: any) {
    console.error('Erro na rota de envio de rastreio por e-mail:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
