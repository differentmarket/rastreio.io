import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { periodo, status, descricao, localidade } = body;

    if (!status || !descricao) {
      return NextResponse.json({ error: 'Status e descrição do evento são obrigatórios.' }, { status: 400 });
    }

    // Calcular data limite com base no período
    let query = supabaseAdmin.from('orders').select('id, created_at, trackings(id, status, historico)');
    const agora = new Date();

    if (periodo === 'hoje') {
      const hojeInicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
      query = query.gte('created_at', hojeInicio);
    } else if (periodo === 'ontem') {
      const ontemInicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1).toISOString();
      const ontemFim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
      query = query.gte('created_at', ontemInicio).lt('created_at', ontemFim);
    } else if (periodo === 'semana') {
      const semanaInicio = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', semanaInicio);
    } else if (periodo === 'antigo') {
      const semanaInicio = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.lt('created_at', semanaInicio);
    }

    const { data: orders, error: fetchErr } = await query;
    if (fetchErr) {
      console.error('Erro ao buscar pedidos para atualização em lote:', fetchErr);
      return NextResponse.json({ error: 'Erro ao filtrar pedidos.' }, { status: 500 });
    }

    if (!orders || orders.length === 0) {
      return NextResponse.json({ success: true, updatedCount: 0, message: 'Nenhum pedido encontrado para o período selecionado.' });
    }

    // Criar o objeto do novo evento
    const novoEvento = {
      status,
      titulo: status === 'postado' ? 'Objeto Postado' 
            : status === 'em_transito' ? 'Objeto em trânsito'
            : status === 'saiu_para_entrega' ? 'Saiu para entrega'
            : 'Objeto entregue',
      descricao,
      localidade: localidade || '',
      data: new Date().toISOString(),
    };

    let updatedCount = 0;

    for (const order of orders) {
      const tracking: any = Array.isArray(order.trackings) ? order.trackings[0] : order.trackings;
      if (tracking?.id) {
        // Unir histórico existente com o novo evento
        const historicoExistente = Array.isArray(tracking.historico) ? tracking.historico : [];
        const novoHistorico = [...historicoExistente, novoEvento];

        // Atualizar status e histórico no Supabase
        const { error: updErr } = await supabaseAdmin
          .from('trackings')
          .update({
            status,
            historico: novoHistorico,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tracking.id);

        if (!updErr) {
          updatedCount++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      updatedCount,
      message: `${updatedCount} pedidos atualizados com sucesso para o status "${status}".`,
    });
  } catch (err: any) {
    console.error('Erro na atualização de eventos em massa:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
