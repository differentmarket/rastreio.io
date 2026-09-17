import { NextRequest, NextResponse } from 'next/server';
import { validateTenantAccess } from '@/lib/authHelper';
import { enqueueJourney } from '@/lib/trackingJourney';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tracking-journey/enqueue
 * Body: { store_id, order_id, order_created_at? }
 *
 * Enfileira um pedido na jornada de rastreio de 15 dias.
 * Chamado automaticamente pelos webhooks/sync da Shopify, ou manualmente pelo admin.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { store_id, order_id, order_created_at } = body;

    if (!store_id) {
      return NextResponse.json({ error: 'store_id é obrigatório.' }, { status: 400 });
    }
    if (!order_id) {
      return NextResponse.json({ error: 'order_id é obrigatório.' }, { status: 400 });
    }

    const tenant = await validateTenantAccess(req, store_id);
    if (!tenant.authorized) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const result = await enqueueJourney(order_id, store_id, order_created_at);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Erro ao enfileirar jornada.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      already_exists: result.alreadyExists ?? false,
      message: result.alreadyExists
        ? 'Jornada já estava ativa para este pedido.'
        : 'Jornada enfileirada com sucesso.',
    });
  } catch (err: any) {
    console.error('[JOURNEY ENQUEUE]', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
