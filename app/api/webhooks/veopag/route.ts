import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    console.log('Webhook VeoPag recebido:', payload);

    const { status, external_id } = payload;

    // Se o status for COMPLETED e tivermos o external_id contendo tracking_id
    if (status === 'COMPLETED' && external_id && external_id.startsWith('tracking_id:')) {
      const parts = external_id.split(':');
      const trackingId = parts[1];

      // Buscar o rastreamento
      const { data: tracking, error: trackErr } = await supabaseAdmin
        .from('trackings')
        .select('*')
        .eq('id', trackingId)
        .maybeSingle();

      if (trackErr || !tracking) {
        console.error('Rastreamento não encontrado para o webhook:', trackingId);
        return NextResponse.json({ error: 'Rastreio não encontrado.' }, { status: 404 });
      }

      // Adicionar evento de liberação no histórico e atualizar o status do rastreio
      const currentHistory = Array.isArray(tracking.historico) ? tracking.historico : [];
      const updatedHistory = [
        ...currentHistory,
        {
          status: 'em_transito',
          data: new Date().toISOString(),
          descricao: 'Taxa de liberação paga com sucesso. Objeto liberado e reencaminhado ao destinatário.',
          local: 'Central de Distribuição dos Correios / Alfândega'
        }
      ];

      const { error: updateErr } = await supabaseAdmin
        .from('trackings')
        .update({
          status: 'em_transito',
          historico: updatedHistory,
          updated_at: new Date().toISOString()
        })
        .eq('id', tracking.id);

      if (updateErr) {
        console.error('Erro ao atualizar o rastreamento após pagamento:', updateErr);
        return NextResponse.json({ error: 'Erro ao atualizar dados.' }, { status: 500 });
      }

      // Atualizar o registro financeiro na tabela tax_payments
      try {
        await supabaseAdmin
          .from('tax_payments')
          .update({
            status: 'pago',
            paid_at: new Date().toISOString(),
          })
          .eq('tracking_id', tracking.id)
          .eq('status', 'pendente');
      } catch (errTax) {
        console.error('Erro ao atualizar status em tax_payments:', errTax);
      }

      console.log('Rastreio liberado com sucesso após Pix VeoPag:', tracking.codigo_rastreio);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Erro no webhook da VeoPag:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
