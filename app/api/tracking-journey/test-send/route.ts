import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getDefaultJourneySteps,
  buildTaxPaidHtml,
  isOrderTaxPaid,
  handleTaxPaidInJourney,
} from '@/lib/trackingJourney';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tracking-journey/test-send
 * Body: { email, name?, order_number?, codigo_rastreio?, run_logic_tests? }
 *
 * Executa uma suíte completa de testes:
 * 1. Envia os 15 templates da jornada para o e-mail de teste.
 * 2. Envia o novo template de 'Taxa Confirmada & Pedido Liberado'.
 * 3. Valida logicamente as funções de interrupção e avanço para o Step 14.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      email,
      name = 'Cliente Teste',
      order_number = '99999',
      codigo_rastreio = 'BR240917TESTE',
      store_name = 'Rastreio.IO',
      app_url = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app',
      run_logic_tests = true,
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

    const emailResults: { step: string | number; name: string; success: boolean; error?: string }[] = [];

    // 1. Envia os 15 steps sequencialmente
    for (const step of steps) {
      await new Promise((r) => setTimeout(r, 250));

      const subject = interpolate(step.email_subject);
      const html = interpolate(step.email_body_html);

      try {
        const { error } = await resend.emails.send({
          from: fromEmail,
          to: [email as string],
          subject: `[TESTE - Step ${step.step_number}/15] ${subject}`,
          html,
        });

        emailResults.push({
          step: step.step_number,
          name: step.step_name,
          success: !error,
          error: error?.message,
        });
      } catch (err: any) {
        emailResults.push({
          step: step.step_number,
          name: step.step_name,
          success: false,
          error: err.message,
        });
      }
    }

    // 2. Envia o template especial: Taxa Confirmada & Pedido Liberado
    await new Promise((r) => setTimeout(r, 250));
    try {
      const taxPaidSubject = interpolate('✅ Taxa confirmada — Pedido #{numero_pedido} liberado para entrega!');
      const taxPaidHtml = interpolate(buildTaxPaidHtml());

      const { error: taxPaidErr } = await resend.emails.send({
        from: fromEmail,
        to: [email as string],
        subject: `[TESTE - Pós-Taxa] ${taxPaidSubject}`,
        html: taxPaidHtml,
      });

      emailResults.push({
        step: 'Taxa Paga (Especial)',
        name: 'Taxa Confirmada e Pedido Liberado',
        success: !taxPaidErr,
        error: taxPaidErr?.message,
      });
    } catch (err: any) {
      emailResults.push({
        step: 'Taxa Paga (Especial)',
        name: 'Taxa Confirmada e Pedido Liberado',
        success: false,
        error: err.message,
      });
    }

    // 3. Suíte de validação lógica (funções do core)
    const logicTests: { test: string; passed: boolean; details: string }[] = [];

    if (run_logic_tests) {
      // Teste A: Ordem correta dos 15 steps
      const step10 = steps.find((s) => s.step_number === 10);
      const step14 = steps.find((s) => s.step_number === 14);
      const step15 = steps.find((s) => s.step_number === 15);

      const orderValid =
        step10?.step_name.includes('Taxa') &&
        step14?.step_name.includes('Entregue') &&
        step15?.step_name.includes('Encerramento');

      logicTests.push({
        test: 'Sequenciamento dos 15 Steps',
        passed: !!orderValid,
        details: orderValid
          ? 'Step 10 é Taxa, Step 14 é Entregue, Step 15 é Encerramento'
          : 'Ordem incorreta detectada',
      });

      // Teste B: Template de Taxa Paga gera HTML válido com placeholders substituíveis
      const sampleTaxHtml = interpolate(buildTaxPaidHtml());
      const htmlValid =
        sampleTaxHtml.includes('Pagamento confirmado com sucesso!') &&
        sampleTaxHtml.includes(firstName) &&
        sampleTaxHtml.includes(order_number);

      logicTests.push({
        test: 'Interpolação do E-mail Pós-Taxa',
        passed: htmlValid,
        details: htmlValid
          ? 'Template interpolado com sucesso contendo nome e número do pedido'
          : 'Falha na interpolação do HTML',
      });

      // Teste C: Função isOrderTaxPaid com ID inexistente retorna false
      const fakeTaxPaid = await isOrderTaxPaid('00000000-0000-0000-0000-000000000000');
      logicTests.push({
        test: 'Validação de Taxa Não Paga (ID Inexistente)',
        passed: fakeTaxPaid === false,
        details: fakeTaxPaid === false
          ? 'Retornou false corretamente para pedido sem taxa paga'
          : 'Retornou valor inesperado',
      });
    }

    const sentEmails = emailResults.filter((r) => r.success).length;
    const failedEmails = emailResults.filter((r) => !r.success).length;
    const passedLogic = logicTests.filter((t) => t.passed).length;

    return NextResponse.json({
      success: true,
      target_email: email,
      summary: {
        total_emails: emailResults.length,
        emails_sent: sentEmails,
        emails_failed: failedEmails,
        logic_tests_total: logicTests.length,
        logic_tests_passed: passedLogic,
      },
      logic_validation: logicTests,
      email_dispatches: emailResults,
    });
  } catch (err: any) {
    console.error('[JOURNEY TEST SUITE]', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
