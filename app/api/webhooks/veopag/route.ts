import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Capturar token ou assinatura recebida nos cabeçalhos
    const authHeader = req.headers.get('authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const signatureHeader = (
      req.headers.get('x-veopag-signature') ||
      req.headers.get('x-webhook-secret') ||
      req.headers.get('apikey') ||
      bearerToken ||
      ''
    ).trim();

    if (!signatureHeader) {
      return NextResponse.json(
        { error: 'Não autorizado: assinatura ou token de autenticação ausente.' },
        { status: 401 }
      );
    }

    const payload = await req.json().catch(() => ({}));
    const { status, external_id } = payload;

    if (!external_id || typeof external_id !== 'string' || !external_id.startsWith('tracking_id:')) {
      return NextResponse.json({ error: 'Parâmetro external_id inválido.' }, { status: 400 });
    }

    const parts = external_id.split(':');
    const trackingId = parts[1];

    if (!trackingId) {
      return NextResponse.json({ error: 'Identificador de rastreamento não encontrado no external_id.' }, { status: 400 });
    }

    // 2. Buscar o rastreamento e resolver o tenant internamente pelo banco de dados
    const { data: tracking, error: trackErr } = await supabaseAdmin
      .from('trackings')
      .select('id, codigo_rastreio, store_id, historico, orders ( id, store_id )')
      .eq('id', trackingId)
      .maybeSingle();

    if (trackErr || !tracking) {
      return NextResponse.json({ error: 'Rastreio não encontrado.' }, { status: 404 });
    }

    const orderData: any = Array.isArray(tracking.orders) ? tracking.orders[0] : tracking.orders;
    const resolvedStoreId = tracking.store_id || orderData?.store_id || null;

    // 3. Obter o segredo configurado da loja dona do rastreio
    let expectedSecret = '';
    if (resolvedStoreId) {
      const { data: store } = await supabaseAdmin
        .from('stores')
        .select('veopag_client_secret')
        .eq('id', resolvedStoreId)
        .maybeSingle();
      if (store?.veopag_client_secret) {
        expectedSecret = store.veopag_client_secret.trim();
      }
    }

    // Fallback se for loja principal sem secret cadastrado na tabela stores
    if (!expectedSecret) {
      const { data: dbSettings } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'VEOPAG_CLIENT_SECRET')
        .maybeSingle();
      expectedSecret = (dbSettings?.value || process.env.VEOPAG_CLIENT_SECRET || '').trim();
    }

    // 4. Validar autenticidade: segredo deve bater estritamente
    if (!expectedSecret || signatureHeader !== expectedSecret) {
      return NextResponse.json(
        { error: 'Não autorizado: assinatura VeoPag inválida.' },
        { status: 401 }
      );
    }

    // 5. Se o status for COMPLETED, atualizar rastreamento e registro financeiro
    if (status === 'COMPLETED') {
      const currentHistory = Array.isArray(tracking.historico) ? tracking.historico : [];
      const updatedHistory = [
        ...currentHistory,
        {
          status: 'em_transito',
          data: new Date().toISOString(),
          descricao: 'Taxa de liberação paga com sucesso. Objeto liberado e reencaminhado ao destinatário.',
          local: 'Central de Distribuição dos Correios / Alfândega',
        },
      ];

      const { error: updateErr } = await supabaseAdmin
        .from('trackings')
        .update({
          status: 'em_transito',
          historico: updatedHistory,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tracking.id);

      if (updateErr) {
        console.error('Erro ao atualizar o rastreamento após pagamento VeoPag:', updateErr);
        return NextResponse.json({ error: 'Erro ao atualizar dados.' }, { status: 500 });
      }

      // Atualizar o registro financeiro na tabela tax_payments associado ao tracking
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
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Erro no webhook da VeoPag:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
