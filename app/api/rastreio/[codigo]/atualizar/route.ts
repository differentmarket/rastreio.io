import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';
import { atualizarStatusPedidoShopify } from '@/lib/shopifyService';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  try {
    const { codigo } = await params;

    // 1. Validar autenticação admin
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json();
    const { status, descricao, local } = body;

    if (!status || !descricao || !local) {
      return NextResponse.json(
        { error: 'Parâmetros inválidos. Status, descrição e local são obrigatórios.' },
        { status: 400 }
      );
    }

    // Bypass com dados mockados para simular atualização de status
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl.includes('mock-project')) {
      const novoEvento = {
        status,
        data: new Date().toISOString(),
        descricao,
        local,
      };
      return NextResponse.json({ ok: true, tracking: { status, historico: [novoEvento] } });
    }

    // 2. Buscar rastreamento atual
    const { data: tracking, error: fetchError } = await supabaseAdmin
      .from('trackings')
      .select('id, status, historico, order_id, orders ( shopify_order_id )')
      .eq('codigo_rastreio', codigo.toUpperCase().trim())
      .maybeSingle();

    if (fetchError || !tracking) {
      return NextResponse.json(
        { error: 'Código de rastreio não encontrado.' },
        { status: 404 }
      );
    }

    // 3. Atualizar o histórico
    const novoEvento = {
      status,
      data: new Date().toISOString(),
      descricao,
      local,
    };

    const historicoAtual = Array.isArray(tracking.historico) ? tracking.historico : [];
    const novoHistorico = [...historicoAtual, novoEvento];

    const { error: updateError } = await supabaseAdmin
      .from('trackings')
      .update({
        status,
        historico: novoHistorico,
      })
      .eq('id', tracking.id);

    if (updateError) {
      console.error('Erro ao atualizar rastreamento:', updateError);
      return NextResponse.json(
        { error: 'Falha ao salvar as alterações no banco de dados.' },
        { status: 500 }
      );
    }

    // Sincroniza o novo status com o Shopify adicionando/atualizando tags no pedido
    const orderData: any = Array.isArray(tracking.orders) ? tracking.orders[0] : tracking.orders;
    if (orderData && orderData.shopify_order_id) {
      await atualizarStatusPedidoShopify(orderData.shopify_order_id, status);
    }

    return NextResponse.json({ ok: true, tracking: { status, historico: novoHistorico } });
  } catch (err: any) {
    console.error('Erro na rota de atualização:', err);
    return NextResponse.json(
      { error: err.message || 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}
