import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTenantAccess } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

/**
 * GET /api/recovery/steps?store_id=UUID
 * Retorna a sequência configurada de passos da loja ativa.
 * Acesso permitido para owner, member autorizado e superadmin.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeIdParam = searchParams.get('store_id');

    const tenant = await validateTenantAccess(req, storeIdParam);
    if (!tenant.authorized) {
      return NextResponse.json({ error: tenant.error || 'Não autorizado.' }, { status: tenant.status });
    }

    const targetStoreId = tenant.targetStoreId || tenant.allowedStoreIds[0];
    if (!targetStoreId) {
      return NextResponse.json({ error: 'Nenhuma loja especificada ou disponível.' }, { status: 400 });
    }

    const { data: steps, error } = await supabaseAdmin
      .from('recovery_steps')
      .select('id, store_id, step_number, step_name, delay_minutes, channel, template_text, coupon_code, is_active, published_at, created_at, updated_at')
      .eq('store_id', targetStoreId)
      .order('step_number', { ascending: true });

    if (error) {
      console.error('Erro ao consultar recovery_steps:', error);
      return NextResponse.json({ error: 'Falha ao buscar passos de recuperação.' }, { status: 500 });
    }

    return NextResponse.json({
      store_id: targetStoreId,
      steps: steps || [],
      can_edit: tenant.isSuperAdmin || tenant.role === 'owner',
    });
  } catch (err: any) {
    console.error('Erro geral em GET /api/recovery/steps:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}

/**
 * PUT /api/recovery/steps
 * Salva e/ou publica a régua de passos da loja ativa.
 * Apenas OWNER ou SUPERADMIN podem salvar/publicar.
 * Limite estrito de no máximo 5 passos por loja.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { store_id, steps, publish } = body;

    if (!store_id) {
      return NextResponse.json({ error: 'store_id é obrigatório.' }, { status: 400 });
    }

    const tenant = await validateTenantAccess(req, store_id);
    if (!tenant.authorized) {
      return NextResponse.json({ error: tenant.error || 'Não autorizado.' }, { status: tenant.status });
    }

    // Regra estrita de permissão: apenas OWNER ou SUPERADMIN podem alterar a régua
    if (!tenant.isSuperAdmin && tenant.role !== 'owner') {
      return NextResponse.json(
        { error: 'Apenas proprietários (owner) possuem permissão para configurar a régua de recuperação.' },
        { status: 403 }
      );
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'Pelo menos um passo deve ser fornecido.' }, { status: 400 });
    }

    // Limite estrito de 5 passos
    if (steps.length > 5) {
      return NextResponse.json({ error: 'A régua permite no máximo 5 passos ativos por loja.' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const publishedAt = publish ? nowIso : undefined;

    // Sanitizar e preparar cada passo
    const sanitizedSteps = steps.map((s: any, idx: number) => {
      const stepNumber = idx + 1; // 1-based index sequencial
      const delayMinutes = Math.max(5, Number(s.delay_minutes) || 30);
      return {
        store_id: tenant.targetStoreId,
        step_number: stepNumber,
        step_name: (s.step_name || `Passo ${stepNumber}`).trim(),
        delay_minutes: delayMinutes,
        channel: s.channel || 'whatsapp',
        template_text: (s.template_text || '').trim(),
        coupon_code: (s.coupon_code || '').trim(),
        is_active: s.is_active !== false,
        updated_at: nowIso,
        ...(publishedAt ? { published_at: publishedAt } : {}),
      };
    });

    // 1. Upsert atômico de cada passo garantindo integridade
    for (const stepData of sanitizedSteps) {
      const { error: upsertErr } = await supabaseAdmin
        .from('recovery_steps')
        .upsert(stepData, { onConflict: 'store_id, step_number' });

      if (upsertErr) {
        console.error('Erro ao fazer upsert em recovery_steps:', upsertErr);
        return NextResponse.json({ error: `Falha ao salvar passo ${stepData.step_number}: ${upsertErr.message}` }, { status: 500 });
      }
    }

    // 2. Remove passos excedentes além do número enviado (ex: lojista reduziu de 4 para 2 passos)
    const maxStepSent = sanitizedSteps.length;
    await supabaseAdmin
      .from('recovery_steps')
      .delete()
      .eq('store_id', tenant.targetStoreId)
      .gt('step_number', maxStepSent);

    // 3. Consulta os passos atualizados para retornar a resposta final
    const { data: updatedSteps } = await supabaseAdmin
      .from('recovery_steps')
      .select('*')
      .eq('store_id', tenant.targetStoreId)
      .order('step_number', { ascending: true });

    return NextResponse.json({
      message: publish ? 'Régua de recuperação publicada com sucesso!' : 'Passos salvos com sucesso.',
      store_id: tenant.targetStoreId,
      published: !!publish,
      steps: updatedSteps || sanitizedSteps,
    });
  } catch (err: any) {
    console.error('Erro geral em PUT /api/recovery/steps:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
