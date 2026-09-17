import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getDefaultJourneySteps } from '@/lib/trackingJourney';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tracking-journey/test-send
 * Body: { email, name?, order_number?, codigo_rastreio? }
 *
 * Envia os 15 templates da jornada imediatamente para um e-mail de teste,
 * ignorando D+, fila e banco — apenas para validar entrega e visual dos e-mails.
 *
 * ⚠️ Endpoint exclusivo para testes. Não usar em produção.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      email,
      name = 'Cliente Teste',
      order_number = '12345',
      codigo_rastreio = 'BR240917TESTE',
      store_name = 'Rastreio.IO',
      app_url = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app',
    } = body;

    if (!email) {
      return NextResponse.json({ error: 'email é obrigatório.' }, { status: 400 });
    }

    // Carrega credenciais Resend (global settings ou env)
    let apiKey = process.env.RESEND_API_KEY || '';
    let fromEmail = process.env.RESEND_FROM_EMAIL || 'Rastreio <noreply@rastreio.io>';

    try {
      const { data: settings } = await supabaseAdmin
        .from('settings')
        .select('key, value');
      if (settings) {
        for (const s of settings) {
          if (s.key === 'RESEND_API_KEY' && s.value) apiKey = s.value;
          if (s.key === 'RESEND_FROM_EMAIL' && s.value) fromEmail = s.value;
        }
      }
    } catch (_) {
      // Ignora erros do banco em modo de teste
    }

    if (!apiKey || apiKey === 'mock-resend-key') {
      return NextResponse.json(
        { error: 'RESEND_API_KEY não configurada. Configure em Settings > Resend no painel.' },
        { status: 400 }
      );
    }

    const resend = new Resend(apiKey);
    const steps = getDefaultJourneySteps();

    const trackingUrl = `${app_url}/rastreio/${codigo_rastreio}`;
    const firstName = (name as string).split(' ')[0];

    // Variáveis do template
    const templateVars: Record<string, string> = {
      primeiro_nome: firstName,
      nome_completo: name,
      numero_pedido: order_number,
      codigo_rastreio,
      link_rastreio: trackingUrl,
      nome_loja: store_name,
    };

    function interpolate(text: string) {
      return text.replace(/\{(\w+)\}/g, (_, key) => templateVars[key] ?? `{${key}}`);
    }

    const results: { step: number; name: string; success: boolean; error?: string }[] = [];

    // Envia cada step sequencialmente com 300ms de delay entre eles (evita rate limit)
    for (const step of steps) {
      await new Promise((r) => setTimeout(r, 300));

      const subject = interpolate(step.email_subject);
      const html = interpolate(step.email_body_html);

      try {
        const { error } = await resend.emails.send({
          from: fromEmail,
          to: [email as string],
          subject: `[TESTE - Step ${step.step_number}/15] ${subject}`,
          html,
        });

        results.push({
          step: step.step_number,
          name: step.step_name,
          success: !error,
          error: error?.message,
        });

        console.log(
          `[JOURNEY TEST] Step ${step.step_number} → ${email}: ${error ? '❌ ' + error.message : '✅ OK'}`
        );
      } catch (err: any) {
        results.push({
          step: step.step_number,
          name: step.step_name,
          success: false,
          error: err.message,
        });
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      summary: {
        total: steps.length,
        sent,
        failed,
        email,
      },
      results,
    });
  } catch (err: any) {
    console.error('[JOURNEY TEST]', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
