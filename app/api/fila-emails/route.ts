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
    const storeId = req.nextUrl.searchParams.get('store_id');

    // Obter o email do usuário a partir do token
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.split(' ')[1] : null;
    let userEmail = '';

    if (token) {
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user) {
          userEmail = user.email || '';
        }
      } catch (e) {
        console.error('Erro ao obter usuário a partir do token no fila-emails:', e);
      }
    }

    // Validar acesso à loja (se não for mock)
    if (!supabaseUrl.includes('mock-project')) {
      if (!storeId) {
        return NextResponse.json({ error: 'store_id é obrigatório.' }, { status: 400 });
      }

      const { data: isAssociated, error: assocError } = await supabaseAdmin
        .from('store_users')
        .select('id')
        .eq('store_id', storeId)
        .eq('user_email', userEmail)
        .maybeSingle();

      if (assocError || !isAssociated) {
        return NextResponse.json({ error: 'Acesso negado a esta loja.' }, { status: 403 });
      }
    }

    // Modo mock
    if (supabaseUrl.includes('mock-project')) {
      const now = Date.now();
      const mockQueue = [
        {
          id: 'mock-order-1',
          numero_pedido: '1001',
          created_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
          status_pedido: 'entregue',
          customers: { nome: 'Carlos Silva', email: 'carlos.silva@example.com' },
          trackings: {
            codigo_rastreio: 'BR2607X8F3K9',
            status: 'entregue',
            email_enviado: true,
            email_enviado_em: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
            shopify_synced: true,
          },
        },
        {
          id: 'mock-order-2',
          numero_pedido: '1002',
          created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
          status_pedido: 'pago',
          customers: { nome: 'Maria Souza', email: 'maria.souza@example.com' },
          trackings: {
            codigo_rastreio: 'BR2607A3F9K1',
            status: 'em_transito',
            email_enviado: false,
            email_enviado_em: null,
            shopify_synced: false,
          },
        },
        {
          id: 'mock-order-3',
          numero_pedido: '1003',
          created_at: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
          status_pedido: 'pendente',
          customers: { nome: 'João Pereira', email: 'joao.pereira@example.com' },
          trackings: {
            codigo_rastreio: 'BR2607T4Y7P2',
            status: 'postado',
            email_enviado: false,
            email_enviado_em: null,
            shopify_synced: false,
          },
        },
        {
          id: 'mock-shopify-5001',
          numero_pedido: '5001',
          created_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
          status_pedido: 'pago',
          customers: { nome: 'Ana Lima', email: 'ana.lima@example.com' },
          trackings: {
            codigo_rastreio: 'BR0000005001SP',
            status: 'postado',
            email_enviado: false,
            email_enviado_em: null,
            shopify_synced: false,
          },
        },
        {
          id: 'mock-shopify-5002',
          numero_pedido: '5002',
          created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
          status_pedido: 'pago',
          customers: { nome: 'Bruno Carvalho', email: 'bruno.carvalho@example.com' },
          trackings: {
            codigo_rastreio: 'BR0000005002SP',
            status: 'postado',
            email_enviado: false,
            email_enviado_em: null,
            shopify_synced: false,
          },
        },
        {
          id: 'mock-shopify-5004',
          numero_pedido: '5004',
          created_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
          status_pedido: 'enviado',
          customers: { nome: 'Diego Fonseca', email: 'diego.fonseca@example.com' },
          trackings: {
            codigo_rastreio: 'BR0000005004SP',
            status: 'entregue',
            email_enviado: true,
            email_enviado_em: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
            shopify_synced: true,
          },
        },
      ];

      return NextResponse.json(mockQueue);
    }

    // Produção
    let query = supabaseAdmin
      .from('orders')
      .select(`
        id,
        numero_pedido,
        status_pedido,
        created_at,
        raw_payload,
        customers ( nome, email ),
        trackings ( codigo_rastreio, status, email_enviado, email_enviado_em, shopify_synced )
      `)
      .in('status_pedido', ['pago', 'separacao', 'enviado', 'entregue'])
      .order('created_at', { ascending: false });

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Erro ao buscar fila de e-mails:', error);
      return NextResponse.json({ error: 'Erro ao buscar dados.' }, { status: 500 });
    }

    const formatted = (orders || []).map((o: any) => {
      const cust = Array.isArray(o.customers) ? o.customers[0] : o.customers;
      const trk = Array.isArray(o.trackings) ? o.trackings[0] : o.trackings;
      
      return {
        id: o.id,
        numero_pedido: o.numero_pedido,
        status_pedido: o.status_pedido,
        created_at: o.created_at,
        customers: cust,
        trackings: trk,
        nota_enviada: !!o.raw_payload?.nota_enviada,
        nota_enviada_em: o.raw_payload?.nota_enviada_em || null,
      };
    });

    return NextResponse.json(formatted);
  } catch (err: any) {
    console.error('Erro na rota da fila de e-mails:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
