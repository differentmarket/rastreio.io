import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTenantAccess } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const tenant = await validateTenantAccess(req);
    if (!tenant.authorized) {
      return NextResponse.json({ error: tenant.error || 'Não autorizado.' }, { status: tenant.status });
    }

    // Consulta biblioteca de templates oficiais do sistema
    const { data: templates, error } = await supabaseAdmin
      .from('recovery_template_library')
      .select('id, niche, niche_label, icon, step_number, step_name, default_delay_minutes, default_template_text, default_coupon_code, is_system_template')
      .eq('is_system_template', true)
      .order('niche')
      .order('step_number', { ascending: true });

    if (error) {
      console.error('Erro ao consultar recovery_template_library:', error);
      return NextResponse.json({ error: 'Falha ao buscar modelos de templates.' }, { status: 500 });
    }

    // Agrupar templates por nicho para facilitar renderização no frontend
    const groupedByNiche: Record<string, { label: string; icon: string; steps: any[] }> = {};

    (templates || []).forEach((tpl: any) => {
      if (!groupedByNiche[tpl.niche]) {
        groupedByNiche[tpl.niche] = {
          label: tpl.niche_label,
          icon: tpl.icon || 'ShoppingBag',
          steps: [],
        };
      }
      groupedByNiche[tpl.niche].steps.push(tpl);
    });

    return NextResponse.json({
      templates: templates || [],
      niches: groupedByNiche,
    });
  } catch (err: any) {
    console.error('Erro geral em /api/recovery/templates:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
