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
    const { action = 'add', eventIndex, status, descricao, local, data: customDate } = body;

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

    let historicoAtual = Array.isArray(tracking.historico) ? [...tracking.historico] : [];
    let novoStatus = status || tracking.status;

    if (action === 'delete') {
      if (typeof eventIndex !== 'number' || eventIndex < 0 || eventIndex >= historicoAtual.length) {
        return NextResponse.json({ error: 'Índice do evento para exclusão é inválido.' }, { status: 400 });
      }
      historicoAtual.splice(eventIndex, 1);
      if (historicoAtual.length > 0) {
        novoStatus = historicoAtual[historicoAtual.length - 1].status || novoStatus;
      }
    } else if (action === 'edit') {
      if (typeof eventIndex !== 'number' || eventIndex < 0 || eventIndex >= historicoAtual.length) {
        return NextResponse.json({ error: 'Índice do evento para edição é inválido.' }, { status: 400 });
      }
      if (!status || !descricao || !local) {
        return NextResponse.json({ error: 'Status, descrição e local são obrigatórios.' }, { status: 400 });
      }

      historicoAtual[eventIndex] = {
        status,
        descricao,
        local,
        data: customDate ? new Date(customDate).toISOString() : historicoAtual[eventIndex].data || new Date().toISOString(),
      };
      novoStatus = status;
    } else {
      // action === 'add'
      if (!status || !descricao || !local) {
        return NextResponse.json({ error: 'Status, descrição e local são obrigatórios.' }, { status: 400 });
      }
      const novoEvento = {
        status,
        data: customDate ? new Date(customDate).toISOString() : new Date().toISOString(),
        descricao,
        local,
      };
      historicoAtual.push(novoEvento);
      novoStatus = status;
    }

    const { error: updateError } = await supabaseAdmin
      .from('trackings')
      .update({
        status: novoStatus,
        historico: historicoAtual,
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
      await atualizarStatusPedidoShopify(orderData.shopify_order_id, novoStatus);
    }

    return NextResponse.json({ ok: true, tracking: { status: novoStatus, historico: historicoAtual } });
  } catch (err: any) {
    console.error('Erro na rota de atualização:', err);
    return NextResponse.json(
      { error: err.message || 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}
