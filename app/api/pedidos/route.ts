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
