import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl.includes('mock-project')) {
      const mockOrders = [
        {
          id: "mock-order-1",
          shopify_order_id: 1001,
          numero_pedido: "1001",
          status_pedido: "entregue",
          valor_total: 250.00,
          created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          customers: { nome: "Carlos Silva", email: "carlos.silva@example.com" },
          trackings: { codigo_rastreio: "BR2607X8F3K9", status: "entregue" }
        }
      ];
      return NextResponse.json(mockOrders);
    }

    const { searchParams } = new URL(req.url);
    const storeIdFilter = searchParams.get('store_id');

    // 1. Busca pedidos
    let query = supabaseAdmin
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (storeIdFilter && storeIdFilter !== 'all') {
      query = query.eq('store_id', storeIdFilter);
    }

    const { data: rawOrders, error: ordersErr } = await query;

    if (ordersErr || !rawOrders) {
      console.error('Erro ao buscar orders:', ordersErr);
      return NextResponse.json({ error: 'Falha ao buscar pedidos do banco.' }, { status: 500 });
    }

    if (rawOrders.length === 0) {
      return NextResponse.json([]);
    }

    // 2. Busca todos os clientes e trackings para vincular manualmente (sem depender de FK do Supabase)
    const { data: customers } = await supabaseAdmin.from('customers').select('id, nome, email');
    const { data: trackings } = await supabaseAdmin.from('trackings').select('order_id, codigo_rastreio, status, email_enviado, email_enviado_em, shopify_synced');

    const customerMap = new Map((customers || []).map(c => [c.id, c]));
    const trackingMap = new Map((trackings || []).map(t => [t.order_id, t]));

    const formattedOrders = rawOrders.map((o: any) => {
      const cust = o.customer_id ? customerMap.get(o.customer_id) : null;
      const trk = trackingMap.get(o.id);

      return {
        id: o.id,
        shopify_order_id: o.shopify_order_id,
        numero_pedido: o.numero_pedido || `#${o.order_number || o.shopify_order_id}`,
        status_pedido: o.status_pedido || o.status_pedidos || 'pago',
        valor_total: o.valor_total || 0,
        created_at: o.created_at,
        customers: cust || (o.cliente_nome ? { nome: o.cliente_nome, email: o.cliente_email } : null),
        trackings: trk || null,
        raw_payload: o.raw_payload,
      };
    });

    return NextResponse.json(formattedOrders);
  } catch (err: any) {
    console.error('Erro na rota de listagem de pedidos:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json();
    const { 
      order_id, 
      numero_pedido, 
      nome_cliente, 
      email_cliente, 
      codigo_rastreio, 
      status_rastreio, 
      store_id 
    } = body;

    if (!codigo_rastreio || !status_rastreio || !store_id) {
      return NextResponse.json({ error: 'Código de rastreio, status e ID da loja são obrigatórios.' }, { status: 400 });
    }

    let finalOrderId = order_id;

    // Se não for fornecido um order_id existente, criamos o cliente e o pedido do zero (cadastro manual de teste)
    if (!finalOrderId) {
      if (!numero_pedido || !nome_cliente || !email_cliente) {
        return NextResponse.json({ error: 'Para pedidos novos, número do pedido, nome e e-mail do cliente são obrigatórios.' }, { status: 400 });
      }

      // 1. Criar ou localizar o cliente
      let customerId;
      const { data: existingCustomer } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('email', email_cliente.trim())
        .maybeSingle();

      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const { data: newCustomer, error: custErr } = await supabaseAdmin
          .from('customers')
          .insert({
            nome: nome_cliente,
            email: email_cliente,
          })
          .select('id')
          .single();
        if (custErr) throw custErr;
        customerId = newCustomer.id;
      }

      // 2. Criar o pedido
      const { data: order, error: orderErr } = await supabaseAdmin
        .from('orders')
        .insert({
          numero_pedido: numero_pedido,
          valor_total: 99.90, // valor fictício
          customer_id: customerId,
          store_id,
          status_pedido: 'pago'
        })
        .select('id')
        .single();

      if (orderErr) throw orderErr;
      finalOrderId = order.id;
    }

    // 3. Gerar histórico com base no status do rastreio
    const now = new Date();
    const simulatedHistory = [];

    // Se for pendente_taxa, criamos o histórico simulado das 2 tentativas de entrega falhas
    if (status_rastreio === 'pendente_taxa') {
      simulatedHistory.push(
        {
          status: 'postado',
          data: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          descricao: 'Objeto postado pela loja.',
          local: 'Central de Logística, São Paulo - SP'
        },
        {
          status: 'em_transito',
          data: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
          descricao: 'Objeto em trânsito para Unidade de Tratamento.',
          local: 'Unidade de Tratamento, Curitiba - PR'
        },
        {
          status: 'saiu_para_entrega',
          data: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          descricao: 'Objeto saiu para entrega ao destinatário.',
          local: 'CDD Centro, Curitiba - PR'
        },
        {
          status: 'tentativa_falha',
          data: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000).toISOString(),
          descricao: 'Carteiro não atendido. Objeto retornou para a Central (1ª tentativa).',
          local: 'CDD Centro, Curitiba - PR'
        },
        {
          status: 'saiu_para_entrega',
          data: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          descricao: 'Objeto saiu para entrega ao destinatário.',
          local: 'CDD Centro, Curitiba - PR'
        },
        {
          status: 'tentativa_falha',
          data: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000).toISOString(),
          descricao: 'Carteiro não atendido. Objeto retornou para a Central (2ª tentativa).',
          local: 'CDD Centro, Curitiba - PR'
        }
      );
    } else {
      simulatedHistory.push({
        status: status_rastreio,
        data: now.toISOString(),
        descricao: status_rastreio === 'postado' 
          ? 'Objeto postado pela loja.' 
          : status_rastreio === 'em_transito' 
          ? 'Objeto em trânsito para a Central.' 
          : status_rastreio === 'saiu_para_entrega' 
          ? 'Objeto saiu para entrega.' 
          : 'Objeto entregue ao destinatário.',
        local: 'Central de Logística, São Paulo - SP'
      });
    }

    // 4. Criar o rastreamento
    const { data: tracking, error: trackErr } = await supabaseAdmin
      .from('trackings')
      .insert({
        codigo_rastreio: codigo_rastreio.toUpperCase().trim(),
        status: status_rastreio,
        historico: simulatedHistory,
        order_id: finalOrderId,
        store_id,
        updated_at: now.toISOString()
      })
      .select('*')
      .single();

    if (trackErr) throw trackErr;

    // 5. Disparar Webhook para o Gateway/Automação
    const { sendTrackingToGateway } = await import('@/lib/gatewayWebhook');
    await sendTrackingToGateway(finalOrderId, codigo_rastreio.toUpperCase().trim());

    return NextResponse.json({ success: true, tracking });
  } catch (err: any) {
    console.error('Erro ao cadastrar/vincular rastreio:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
