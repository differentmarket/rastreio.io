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

    // Bypass com dados mockados para testes locais sem banco de dados
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
        },
        {
          id: "mock-order-2",
          shopify_order_id: 1002,
          numero_pedido: "1002",
          status_pedido: "pago",
          valor_total: 120.50,
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          customers: { nome: "Maria Souza", email: "maria.souza@example.com" },
          trackings: { codigo_rastreio: "BR2607A3F9K1", status: "em_transito" }
        },
        {
          id: "mock-order-3",
          shopify_order_id: 1003,
          numero_pedido: "1003",
          status_pedido: "pendente",
          valor_total: 450.00,
          created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
          customers: { nome: "João Pereira", email: "joao.pereira@example.com" },
          trackings: { codigo_rastreio: "BR2607T4Y7P2", status: "postado" }
        }
      ];
      return NextResponse.json(mockOrders);
    }

    // Busca pedidos com informações básicas do cliente e código/status de rastreio
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        shopify_order_id,
        numero_pedido,
        status_pedido,
        valor_total,
        created_at,
        customers (
          nome,
          email
        ),
        trackings (
          codigo_rastreio,
          status,
          email_enviado,
          email_enviado_em,
          shopify_synced
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar pedidos:', error);
      // Tenta fallback sem os joins se der erro de relação
      const { data: fallbackOrders } = await supabaseAdmin
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (fallbackOrders) {
        return NextResponse.json(fallbackOrders.map((o: any) => ({
          ...o,
          numero_pedido: o.numero_pedido || `#${o.order_number || o.shopify_order_id}`,
          customers: o.customers || (o.cliente_nome ? { nome: o.cliente_nome, email: o.cliente_email } : null),
          trackings: o.trackings || null,
        })));
      }

      return NextResponse.json(
        { error: 'Falha ao buscar pedidos do banco de dados.' },
        { status: 500 }
      );
    }

    const formattedOrders = (orders || []).map((o: any) => ({
      ...o,
      numero_pedido: o.numero_pedido || `#${o.order_number || o.shopify_order_id}`,
      customers: Array.isArray(o.customers) ? o.customers[0] : o.customers,
      trackings: Array.isArray(o.trackings) ? o.trackings[0] : o.trackings,
    }));

    return NextResponse.json(formattedOrders);
  } catch (err: any) {
    console.error('Erro na rota de listagem de pedidos:', err);
    return NextResponse.json(
      { error: err.message || 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}
