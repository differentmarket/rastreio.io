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

    const { searchParams } = new URL(req.url);
    const storeIdParam = searchParams.get('store_id');

    let queryTax = supabaseAdmin.from('tax_payments').select('*');
    let queryUpsell = supabaseAdmin.from('upsell_events').select('*');

    if (storeIdParam && storeIdParam !== 'all' && storeIdParam !== 'default-store') {
      queryTax = queryTax.eq('store_id', storeIdParam);
      queryUpsell = queryUpsell.eq('store_id', storeIdParam);
    }

    const [{ data: recordsTax }, { data: recordsUpsell }] = await Promise.all([
      queryTax.order('created_at', { ascending: false }),
      queryUpsell.order('created_at', { ascending: false }),
    ]);

    const allPayments = recordsTax || [];
    const paidPayments = allPayments.filter((p: any) => p.status === 'pago');

    const faturamentoTotal = paidPayments.reduce((acc: number, p: any) => acc + (parseFloat(p.valor_total) || 0), 0);
    const faturamentoBase = paidPayments.reduce((acc: number, p: any) => acc + (parseFloat(p.valor_taxa_base) || 0), 0);

    const bradescoPaid = paidPayments.filter((p: any) => p.order_bump_bradesco === true);
    const faturamentoBradesco = bradescoPaid.reduce((acc: number, p: any) => acc + (parseFloat(p.valor_bump_bradesco) || 0), 0);

    const expressPaid = paidPayments.filter((p: any) => p.order_bump_express === true);
    const faturamentoExpress = expressPaid.reduce((acc: number, p: any) => acc + (parseFloat(p.valor_bump_express) || 0), 0);

    const withBumpCount = paidPayments.filter((p: any) => p.order_bump_bradesco || p.order_bump_express).length;
    const takeRate = paidPayments.length > 0 ? (withBumpCount / paidPayments.length) * 100 : 0;

    // Métricas de Upsells de Recompra
    const allUpsells = recordsUpsell || [];
    const cliquesOferta = allUpsells.filter((u: any) => u.tipo_evento === 'clique_oferta' || u.tipo_evento === 'clique').length;
    const cuponsCopiados = allUpsells.filter((u: any) => u.tipo_evento === 'copiar_cupom').length;
    const faturamentoUpsellEstimado = allUpsells.reduce((acc: number, u: any) => acc + (parseFloat(u.valor_estimado) || 0), 0);

    return NextResponse.json({
      metrics: {
        faturamentoTotal: parseFloat(faturamentoTotal.toFixed(2)),
        faturamentoBase: parseFloat(faturamentoBase.toFixed(2)),
        qtdTaxasPagas: paidPayments.length,
        qtdTaxasGeradas: allPayments.length,
        bradesco: {
          qtd: bradescoPaid.length,
          faturamento: parseFloat(faturamentoBradesco.toFixed(2)),
        },
        express: {
          qtd: expressPaid.length,
          faturamento: parseFloat(faturamentoExpress.toFixed(2)),
        },
        takeRate: parseFloat(takeRate.toFixed(1)),
        upsell: {
          totalEventos: allUpsells.length,
          cliquesOferta,
          cuponsCopiados,
          faturamentoEstimado: parseFloat(faturamentoUpsellEstimado.toFixed(2)),
        },
      },
      recentTransactions: allPayments.slice(0, 50),
      recentUpsells: allUpsells.slice(0, 50),
    });
  } catch (err: any) {
    console.error('Erro no endpoint de analytics de taxas e upsells:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
