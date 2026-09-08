import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTenantAccess } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeIdParam = searchParams.get('store_id');

    // Validação estrita de Tenant
    const tenant = await validateTenantAccess(req, storeIdParam);
    if (!tenant.authorized) {
      return NextResponse.json({ error: tenant.error || 'Não autorizado.' }, { status: tenant.status });
    }

    // 1. Query em recovery_revenue
    let queryRev = supabaseAdmin
      .from('recovery_revenue')
      .select('id, store_id, order_id, valor_total, attribution_type, step_number, tempo_minutos_ate_conversao, sent_at, recovered_at, orders(numero_pedido, valor_total)');

    // 2. Query em recovery_queue
    let queryQueue = supabaseAdmin
      .from('recovery_queue')
      .select('id, store_id, status, scheduled_at, sent_at, cancelled_at');

    // 3. Query em recovery_events
    let queryEvents = supabaseAdmin
      .from('recovery_events')
      .select('id, store_id, event_type, created_at');

    // 4. Query em orders (para total de pedidos com pendência)
    let queryOrders = supabaseAdmin
      .from('orders')
      .select('id, store_id, status_pedido, created_at');

    // Aplicação estrita de filtro de loja / tenant
    if (tenant.targetStoreId) {
      queryRev = queryRev.eq('store_id', tenant.targetStoreId);
      queryQueue = queryQueue.eq('store_id', tenant.targetStoreId);
      queryEvents = queryEvents.eq('store_id', tenant.targetStoreId);
      queryOrders = queryOrders.eq('store_id', tenant.targetStoreId);
    } else if (!tenant.isSuperAdmin) {
      queryRev = queryRev.in('store_id', tenant.allowedStoreIds);
      queryQueue = queryQueue.in('store_id', tenant.allowedStoreIds);
      queryEvents = queryEvents.in('store_id', tenant.allowedStoreIds);
      queryOrders = queryOrders.in('store_id', tenant.allowedStoreIds);
    }

    const [
      { data: revenues, error: revErr },
      { data: queueItems, error: queueErr },
      { data: events, error: evErr },
      { data: orders, error: ordErr }
    ] = await Promise.all([
      queryRev.order('recovered_at', { ascending: false }).limit(50),
      queryQueue,
      queryEvents,
      queryOrders
    ]);

    if (revErr || queueErr) {
      console.error('Erro nas queries de analytics de recuperação:', revErr || queueErr);
    }

    const revList = revenues || [];
    const qList = queueItems || [];
    const evList = events || [];
    const ordList = orders || [];

    // Métricas Calculadas
    const totalAbandonados = qList.length > 0
      ? qList.length
      : ordList.filter((o: any) => o.status_pedido === 'pendente').length;

    const totalEnviadosFila = qList.length;
    const mensagensEnviadas = qList.filter((q: any) => q.status === 'sent').length;

    const deliveredEvents = evList.filter((e: any) => e.event_type === 'delivered' || e.event_type === 'read').length;
    const mensagensEntregues = deliveredEvents > 0 ? deliveredEvents : mensagensEnviadas;

    const totalRecuperados = revList.length;
    const receitaRecuperada = revList.reduce((acc: number, r: any) => acc + (parseFloat(r.valor_total) || 0), 0);

    const taxaConversao = mensagensEnviadas > 0
      ? parseFloat(((totalRecuperados / mensagensEnviadas) * 100).toFixed(1))
      : 0;

    const tempos = revList
      .map((r: any) => r.tempo_minutos_ate_conversao)
      .filter((t: any) => typeof t === 'number' && !isNaN(t) && t >= 0);

    const tempoMedioMinutos = tempos.length > 0
      ? Math.round(tempos.reduce((a: number, b: number) => a + b, 0) / tempos.length)
      : 0;

    const recentRecoveries = revList.slice(0, 10).map((r: any) => {
      const orderObj = Array.isArray(r.orders) ? r.orders[0] : r.orders;
      return {
        id: r.id,
        order_id: r.order_id,
        numero_pedido: orderObj?.numero_pedido || 'N/A',
        valor_total: parseFloat(r.valor_total) || 0,
        attribution_type: r.attribution_type,
        step_number: r.step_number || 1,
        tempo_minutos: r.tempo_minutos_ate_conversao,
        recovered_at: r.recovered_at,
      };
    });

    // Agregação de conversões e receita por etapa da régua (step_1, step_2, etc.)
    const porEtapa: Record<string, { count: number; receita: number }> = {};
    revList.forEach((r: any) => {
      const stp = `step_${r.step_number || 1}`;
      if (!porEtapa[stp]) {
        porEtapa[stp] = { count: 0, receita: 0 };
      }
      porEtapa[stp].count += 1;
      porEtapa[stp].receita = parseFloat((porEtapa[stp].receita + (parseFloat(r.valor_total) || 0)).toFixed(2));
    });

    return NextResponse.json({
      metrics: {
        total_abandonados: totalAbandonados,
        total_enviados_fila: totalEnviadosFila,
        mensagens_enviadas: mensagensEnviadas,
        mensagens_entregues: mensagensEntregues,
        total_recuperados: totalRecuperados,
        receita_recuperada: parseFloat(receitaRecuperada.toFixed(2)),
        taxa_conversao: taxaConversao,
        tempo_medio_minutos: tempoMedioMinutos,
        por_etapa: porEtapa,
      },
      recent_recoveries: recentRecoveries,
    });
  } catch (err: any) {
    console.error('Erro na API de analytics de recuperação:', err);
    return NextResponse.json({ error: err.message || 'Erro interno ao consultar analytics.' }, { status: 500 });
  }
}
