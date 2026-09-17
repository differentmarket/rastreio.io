import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTenantAccess } from '@/lib/authHelper';
import { getDefaultJourneySteps } from '@/lib/trackingJourney';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tracking-journey/steps?store_id=xxx
 * Retorna os 15 steps configurados da loja.
 * Se a loja ainda não possui steps, retorna os defaults de sistema.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const store_id = searchParams.get('store_id');

    if (!store_id) {
      return NextResponse.json({ error: 'store_id é obrigatório.' }, { status: 400 });
    }

    const tenant = await validateTenantAccess(req, store_id);
    if (!tenant.authorized) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    const { data: steps, error } = await supabaseAdmin
      .from('tracking_journey_steps')
      .select('*')
      .eq('store_id', store_id)
      .order('step_number', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Se não há steps configurados, retorna os defaults para o admin usar como seed
    if (!steps || steps.length === 0) {
      const defaults = getDefaultJourneySteps();
      return NextResponse.json({ steps: defaults, is_default: true });
    }

    return NextResponse.json({ steps, is_default: false });
  } catch (err: any) {
    console.error('[JOURNEY STEPS GET]', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

/**
 * POST /api/tracking-journey/steps
 * Body: { store_id, steps: JourneyStep[] }
 * Salva (upsert) a configuração de steps da loja.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { store_id, steps } = body;

    if (!store_id) {
      return NextResponse.json({ error: 'store_id é obrigatório.' }, { status: 400 });
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'steps deve ser um array não vazio.' }, { status: 400 });
    }

    const tenant = await validateTenantAccess(req, store_id);
    if (!tenant.authorized) {
      return NextResponse.json({ error: tenant.error }, { status: tenant.status });
    }

    // Valida e normaliza os steps antes de salvar
    const stepsToUpsert = steps.map((s: any) => ({
      store_id,
      step_number: Number(s.step_number),
      step_name: String(s.step_name || ''),
      step_description: s.step_description || null,
      trigger_type: s.trigger_type || 'day_offset',
      trigger_day_offset: Number(s.trigger_day_offset ?? 0),
      tracking_status_trigger: s.tracking_status_trigger || null,
      email_subject: String(s.email_subject || ''),
      email_body_html: String(s.email_body_html || ''),
      is_active: Boolean(s.is_active ?? true),
    }));

    const { error } = await supabaseAdmin
      .from('tracking_journey_steps')
      .upsert(stepsToUpsert, {
        onConflict: 'store_id,step_number',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error('[JOURNEY STEPS POST]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, saved: stepsToUpsert.length });
  } catch (err: any) {
    console.error('[JOURNEY STEPS POST]', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
