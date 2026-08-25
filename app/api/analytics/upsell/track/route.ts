import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { codigo_rastreio, store_id, cupom_usado, valor_estimado, tipo_evento = 'clique' } = body;

    let targetStoreId = store_id || null;
    let trackingId = null;

    if (codigo_rastreio) {
      const { data: tracking } = await supabaseAdmin
        .from('trackings')
        .select('id, store_id')
        .eq('codigo_rastreio', String(codigo_rastreio).toUpperCase().trim())
        .maybeSingle();

      if (tracking) {
        trackingId = tracking.id;
        if (!targetStoreId && tracking.store_id) {
          targetStoreId = tracking.store_id;
        }
      }
    }

    const { data: eventRecord, error } = await supabaseAdmin
      .from('upsell_events')
      .insert({
        store_id: targetStoreId,
        tracking_id: trackingId,
        cupom_usado: cupom_usado || null,
        valor_estimado: parseFloat(valor_estimado) || 0,
        tipo_evento: tipo_evento || 'clique',
      })
      .select('id')
      .single();

    if (error) {
      console.error('Erro ao registrar evento de upsell:', error);
      return NextResponse.json({ error: 'Falha ao registrar evento.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: eventRecord?.id });
  } catch (err: any) {
    console.error('Erro na rota de tracking de upsell:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
