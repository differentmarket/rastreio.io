import { supabaseAdmin } from './supabaseAdmin';
import { Resend } from 'resend';

// ==============================================================================
// Tipos
// ==============================================================================

export interface JourneyStep {
  id: string;
  store_id: string;
  step_number: number;
  step_name: string;
  step_description: string | null;
  trigger_type: 'day_offset' | 'status_change' | 'status_and_day';
  trigger_day_offset: number;
  tracking_status_trigger: string | null;
  email_subject: string;
  email_body_html: string;
  is_active: boolean;
}

export interface JourneyQueueItem {
  id: string;
  store_id: string;
  order_id: string;
  current_step: number;
  next_step: number;
  next_send_at: string | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  order_created_at: string;
}

// ==============================================================================
// Variáveis de template suportadas
// ==============================================================================
// {primeiro_nome} {nome_completo} {numero_pedido} {codigo_rastreio}
// {link_rastreio} {nome_loja}

function interpolateTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// ==============================================================================
// Carregar credenciais Resend da loja (multi-tenant)
// ==============================================================================
async function getResendCredentials(
  storeId: string
): Promise<{ apiKey: string; fromEmail: string }> {
  // 1. Tenta pegar da loja específica
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('resend_api_key, resend_from_email, nome_loja')
    .eq('id', storeId)
    .single();

  if (store?.resend_api_key) {
    return {
      apiKey: store.resend_api_key,
      fromEmail:
        store.resend_from_email ||
        `${store.nome_loja || 'Loja'} <noreply@rastreio.io>`,
    };
  }

  // 2. Fallback: settings globais ou env
  const { data: settings } = await supabaseAdmin
    .from('settings')
    .select('key, value');

  let apiKey = process.env.RESEND_API_KEY || '';
  let fromEmail =
    process.env.RESEND_FROM_EMAIL || 'Rastreio <noreply@rastreio.io>';

  if (settings) {
    for (const s of settings) {
      if (s.key === 'RESEND_API_KEY' && s.value) apiKey = s.value;
      if (s.key === 'RESEND_FROM_EMAIL' && s.value) fromEmail = s.value;
    }
  }

  return { apiKey, fromEmail };
}

// ==============================================================================
// sendJourneyEmail — envia um e-mail de um step da jornada
// ==============================================================================
async function sendJourneyEmail(params: {
  storeId: string;
  toEmail: string;
  toName: string;
  numeroPedido: string;
  codigoRastreio: string;
  trackingUrl: string;
  nomeLoja: string;
  subject: string;
  bodyHtml: string;
}): Promise<{ success: boolean; error?: string }> {
  const {
    storeId,
    toEmail,
    toName,
    numeroPedido,
    codigoRastreio,
    trackingUrl,
    nomeLoja,
    subject,
    bodyHtml,
  } = params;

  // Interpola variáveis no assunto e corpo
  const templateVars: Record<string, string> = {
    primeiro_nome: toName.split(' ')[0],
    nome_completo: toName,
    numero_pedido: numeroPedido,
    codigo_rastreio: codigoRastreio,
    link_rastreio: trackingUrl,
    nome_loja: nomeLoja,
  };

  const finalSubject = interpolateTemplate(subject, templateVars);
  const finalHtml = interpolateTemplate(bodyHtml, templateVars);

  const { apiKey, fromEmail } = await getResendCredentials(storeId);

  // Mock para desenvolvimento sem API key
  if (!apiKey || apiKey === 'mock-resend-key') {
    console.log('[JOURNEY EMAIL MOCK]', { toEmail, finalSubject });
    return { success: true };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: [toEmail],
      subject: finalSubject,
      html: finalHtml,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro desconhecido' };
  }
}

// ==============================================================================
// enqueueJourney — enfileira um pedido na jornada de 15 dias (D+0)
// ==============================================================================
export async function enqueueJourney(
  orderId: string,
  storeId: string,
  orderCreatedAt?: string
): Promise<{ success: boolean; error?: string; alreadyExists?: boolean }> {
  try {
    // Verifica se já existe jornada ativa para este pedido
    const { data: existing } = await supabaseAdmin
      .from('tracking_journey_queue')
      .select('id, status')
      .eq('order_id', orderId)
      .maybeSingle();

    if (existing) {
      // Se foi cancelada/falhou, permite re-enfileiramento
      if (existing.status === 'active' || existing.status === 'paused') {
        console.log(`[JOURNEY] Pedido ${orderId} já está na jornada (${existing.status}). Ignorando.`);
        return { success: true, alreadyExists: true };
      }
      // Reativa jornada cancelada/falha
      await supabaseAdmin
        .from('tracking_journey_queue')
        .update({
          status: 'active',
          current_step: 0,
          next_step: 1,
          next_send_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      console.log(`[JOURNEY] Jornada reativada para pedido ${orderId}`);
      return { success: true };
    }

    // Busca a data de criação do pedido se não foi passada
    let createdAt = orderCreatedAt;
    if (!createdAt) {
      const { data: order } = await supabaseAdmin
        .from('orders')
        .select('created_at')
        .eq('id', orderId)
        .single();
      createdAt = order?.created_at || new Date().toISOString();
    }

    // Insere na fila — dispara imediatamente (D+0)
    const { error } = await supabaseAdmin
      .from('tracking_journey_queue')
      .insert({
        store_id: storeId,
        order_id: orderId,
        current_step: 0,
        next_step: 1,
        next_send_at: new Date().toISOString(), // Processa na próxima rodada do cron
        status: 'active',
        order_created_at: createdAt,
      });

    if (error) {
      console.error('[JOURNEY] Erro ao enfileirar jornada:', error);
      return { success: false, error: error.message };
    }

    // Log do enfileiramento
    await supabaseAdmin.from('tracking_journey_events').insert({
      store_id: storeId,
      order_id: orderId,
      step_number: 0,
      step_name: 'Jornada Iniciada',
      event_type: 'enqueued',
      channel: 'email',
      success: true,
    });

    console.log(`[JOURNEY] Jornada iniciada para pedido ${orderId}`);
    return { success: true };
  } catch (err: any) {
    console.error('[JOURNEY] Exceção em enqueueJourney:', err);
    return { success: false, error: err.message };
  }
}

// ==============================================================================
// resolveNextStep — dado um item da fila, decide se o próximo step deve ser
// executado agora com base no trigger_type, D+ e status do rastreio.
// ==============================================================================
async function resolveNextStep(
  queueItem: JourneyQueueItem,
  step: JourneyStep
): Promise<{ shouldSend: boolean; reason: string }> {
  const now = new Date();

  // Se há um next_send_at definido e ainda não chegou o momento, aguarda
  if (queueItem.next_send_at && new Date(queueItem.next_send_at) > now) {
    return {
      shouldSend: false,
      reason: `Próximo envio agendado para ${queueItem.next_send_at}`,
    };
  }

  const orderCreatedAt = new Date(queueItem.order_created_at);
  const daysSinceOrder = Math.floor(
    (now.getTime() - orderCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  switch (step.trigger_type) {
    case 'day_offset': {
      if (daysSinceOrder >= step.trigger_day_offset) {
        return { shouldSend: true, reason: `D+${daysSinceOrder} >= D+${step.trigger_day_offset}` };
      }
      return {
        shouldSend: false,
        reason: `Aguardando D+${step.trigger_day_offset} (atual: D+${daysSinceOrder})`,
      };
    }

    case 'status_change': {
      if (!step.tracking_status_trigger) {
        return { shouldSend: true, reason: 'Sem condição de status' };
      }
      // Busca status atual do rastreio para o pedido
      const { data: tracking } = await supabaseAdmin
        .from('trackings')
        .select('status')
        .eq('order_id', queueItem.order_id)
        .maybeSingle();

      if (tracking?.status === step.tracking_status_trigger) {
        return {
          shouldSend: true,
          reason: `Status do rastreio = ${tracking.status}`,
        };
      }
      return {
        shouldSend: false,
        reason: `Aguardando status '${step.tracking_status_trigger}' (atual: '${tracking?.status ?? 'sem rastreio'}')`,
      };
    }

    case 'status_and_day': {
      if (daysSinceOrder < step.trigger_day_offset) {
        return {
          shouldSend: false,
          reason: `Aguardando D+${step.trigger_day_offset} (atual: D+${daysSinceOrder})`,
        };
      }
      if (!step.tracking_status_trigger) {
        return { shouldSend: true, reason: `D+${daysSinceOrder} atingido` };
      }
      const { data: tracking } = await supabaseAdmin
        .from('trackings')
        .select('status')
        .eq('order_id', queueItem.order_id)
        .maybeSingle();

      if (tracking?.status === step.tracking_status_trigger) {
        return { shouldSend: true, reason: `D+${daysSinceOrder} + status correto` };
      }
      return {
        shouldSend: false,
        reason: `D+${daysSinceOrder} OK, mas aguardando status '${step.tracking_status_trigger}' (atual: '${tracking?.status ?? 'sem rastreio'}')`,
      };
    }

    default:
      return { shouldSend: false, reason: 'trigger_type desconhecido' };
  }
}

// ==============================================================================
// processJourneyQueue — cron worker principal
// Processa até `batchSize` itens da fila que estão prontos para envio.
// ==============================================================================
export async function processJourneyQueue(batchSize = 50): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const stats = { processed: 0, sent: 0, skipped: 0, errors: 0 };
  const now = new Date().toISOString();

  // Busca itens da fila que estão ativos e prontos para processar
  const { data: queueItems, error: queueError } = await supabaseAdmin
    .from('tracking_journey_queue')
    .select('*')
    .eq('status', 'active')
    .lte('next_send_at', now)
    .order('next_send_at', { ascending: true })
    .limit(batchSize);

  if (queueError) {
    console.error('[JOURNEY CRON] Erro ao buscar fila:', queueError);
    return stats;
  }

  if (!queueItems || queueItems.length === 0) {
    console.log('[JOURNEY CRON] Nenhum item pendente na fila.');
    return stats;
  }

  console.log(`[JOURNEY CRON] ${queueItems.length} itens para processar.`);

  for (const item of queueItems as JourneyQueueItem[]) {
    stats.processed++;

    // Busca os steps configurados para a loja deste pedido
    const { data: steps, error: stepsError } = await supabaseAdmin
      .from('tracking_journey_steps')
      .select('*')
      .eq('store_id', item.store_id)
      .eq('is_active', true)
      .gte('step_number', item.next_step)
      .order('step_number', { ascending: true })
      .limit(1);

    if (stepsError || !steps || steps.length === 0) {
      // Não há mais steps configurados — jornada concluída
      await supabaseAdmin
        .from('tracking_journey_queue')
        .update({ status: 'completed' })
        .eq('id', item.id);

      await supabaseAdmin.from('tracking_journey_events').insert({
        store_id: item.store_id,
        order_id: item.order_id,
        queue_id: item.id,
        step_number: item.next_step,
        step_name: 'Jornada Concluída',
        event_type: 'completed',
        channel: 'email',
        success: true,
        metadata: { reason: 'Nenhum step ativo restante' },
      });

      stats.skipped++;
      continue;
    }

    const step = steps[0] as JourneyStep;

    // Verifica se deve enviar agora
    const { shouldSend, reason } = await resolveNextStep(item, step);

    if (!shouldSend) {
      console.log(`[JOURNEY CRON] Step ${step.step_number} aguardando: ${reason}`);
      // Agenda próxima verificação para daqui 1 hora
      await supabaseAdmin
        .from('tracking_journey_queue')
        .update({
          next_send_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
        .eq('id', item.id);
      stats.skipped++;
      continue;
    }

    // Busca dados do pedido, cliente e rastreio para preencher o template
    const { data: orderData } = await supabaseAdmin
      .from('orders')
      .select(`
        id, order_number, cliente_nome, cliente_email, valor_total, store_id,
        trackings (codigo_rastreio, status),
        stores (nome_loja, resend_from_email)
      `)
      .eq('id', item.order_id)
      .maybeSingle();

    if (!orderData || !orderData.cliente_email) {
      console.warn(`[JOURNEY CRON] Pedido ${item.order_id} sem e-mail. Pulando.`);
      await supabaseAdmin
        .from('tracking_journey_queue')
        .update({ status: 'failed' })
        .eq('id', item.id);
      await supabaseAdmin.from('tracking_journey_events').insert({
        store_id: item.store_id,
        order_id: item.order_id,
        queue_id: item.id,
        step_number: step.step_number,
        step_name: step.step_name,
        event_type: 'failed',
        channel: 'email',
        success: false,
        error_message: 'Pedido sem e-mail de cliente',
      });
      stats.errors++;
      continue;
    }

    const trackingInfo = Array.isArray(orderData.trackings)
      ? orderData.trackings[0]
      : orderData.trackings;
    const storeInfo = Array.isArray(orderData.stores)
      ? orderData.stores[0]
      : orderData.stores;

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
    const codigoRastreio = trackingInfo?.codigo_rastreio || '';
    const trackingUrl = codigoRastreio
      ? `${appUrl}/rastreio/${codigoRastreio}`
      : `${appUrl}`;

    // Envia o e-mail
    const emailResult = await sendJourneyEmail({
      storeId: item.store_id,
      toEmail: orderData.cliente_email,
      toName: orderData.cliente_nome || 'Cliente',
      numeroPedido: orderData.order_number || orderData.id.slice(0, 8),
      codigoRastreio,
      trackingUrl,
      nomeLoja: storeInfo?.nome_loja || 'Loja',
      subject: step.email_subject,
      bodyHtml: step.email_body_html,
    });

    // Log do resultado
    await supabaseAdmin.from('tracking_journey_events').insert({
      store_id: item.store_id,
      order_id: item.order_id,
      queue_id: item.id,
      step_number: step.step_number,
      step_name: step.step_name,
      event_type: emailResult.success ? 'sent' : 'failed',
      channel: 'email',
      success: emailResult.success,
      error_message: emailResult.error || null,
      email_to: orderData.cliente_email,
      metadata: { reason },
    });

    if (emailResult.success) {
      stats.sent++;

      // Avança para o próximo step
      const nextStepNumber = step.step_number + 1;
      const isLastStep = step.step_number >= 15;

      await supabaseAdmin
        .from('tracking_journey_queue')
        .update({
          current_step: step.step_number,
          next_step: nextStepNumber,
          status: isLastStep ? 'completed' : 'active',
          // Próxima verificação em 1 hora (o cron vai checar se o próximo step está pronto)
          next_send_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
        .eq('id', item.id);

      console.log(
        `[JOURNEY CRON] ✅ Step ${step.step_number} enviado para ${orderData.cliente_email} (pedido ${orderData.order_number})`
      );
    } else {
      stats.errors++;
      console.error(
        `[JOURNEY CRON] ❌ Falha no step ${step.step_number} para pedido ${item.order_id}: ${emailResult.error}`
      );

      // Reagenda para daqui 30 minutos para retry
      await supabaseAdmin
        .from('tracking_journey_queue')
        .update({
          next_send_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        })
        .eq('id', item.id);
    }
  }

  console.log(
    `[JOURNEY CRON] Concluído — processados: ${stats.processed}, enviados: ${stats.sent}, pulados: ${stats.skipped}, erros: ${stats.errors}`
  );

  return stats;
}

// ==============================================================================
// getDefaultSteps — retorna os 15 steps padrão para seed/preview no admin
// (usados quando a loja ainda não tem steps configurados)
// ==============================================================================
export function getDefaultJourneySteps(): Omit<
  JourneyStep,
  'id' | 'store_id'
>[] {
  const base = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td align="center" style="padding-bottom:28px;">
          <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:16px;padding:12px 28px;">
            <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:1px;">{{TITULO}}</span>
          </div>
        </td></tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:20px;border:1px solid #334155;overflow:hidden;">
            <tr><td style="background:linear-gradient(90deg,#6366f1,#8b5cf6,#06b6d4);height:4px;"></td></tr>
            <tr><td style="padding:36px;">
              {{BODY}}
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr><td align="center">
                  <a href="{link_rastreio}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:16px 36px;border-radius:12px;">
                    🔍 Acompanhar meu pedido
                  </a>
                </td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:20px 36px;text-align:center;">
              <p style="color:#475569;font-size:12px;margin:0;">{nome_loja} · Este e-mail foi enviado automaticamente.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  function buildHtml(titulo: string, body: string) {
    return base.replace('{{TITULO}}', titulo).replace('{{BODY}}', body);
  }

  return [
    {
      step_number: 1,
      step_name: 'Pedido Confirmado',
      step_description: 'D+0 — Enviado quando o pedido entra no sistema',
      trigger_type: 'day_offset',
      trigger_day_offset: 0,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '✅ Pedido #{numero_pedido} confirmado, {primeiro_nome}!',
      email_body_html: buildHtml('✅ Pedido Confirmado', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong> 👋</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Seu pedido foi confirmado!</h1>
        <p style="color:#64748b;margin:0 0 20px;">O pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> foi recebido com sucesso e já está sendo preparado para envio. Em breve você receberá o código de rastreio.</p>
      `),
    },
    {
      step_number: 2,
      step_name: 'Pedido Postado',
      step_description: 'Quando o rastreio muda para "postado"',
      trigger_type: 'status_change',
      trigger_day_offset: 1,
      tracking_status_trigger: 'postado',
      is_active: true,
      email_subject: '📦 Seu pedido #{numero_pedido} foi postado!',
      email_body_html: buildHtml('📦 Pedido Postado', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Seu pedido saiu do nosso estoque!</h1>
        <p style="color:#64748b;margin:0 0 12px;">O pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> foi postado e seu código de rastreio é:</p>
        <div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:16px;">
          <p style="color:#818cf8;font-size:20px;font-weight:800;font-family:'Courier New',monospace;margin:0;">{codigo_rastreio}</p>
        </div>
        <p style="color:#64748b;margin:0;">Acompanhe em tempo real clicando no botão abaixo.</p>
      `),
    },
    {
      step_number: 3,
      step_name: 'Em Trânsito (1ª Atualização)',
      step_description: 'D+2 — Pedido em trânsito, engajamento',
      trigger_type: 'day_offset',
      trigger_day_offset: 2,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '🚚 Seu pedido está a caminho, {primeiro_nome}!',
      email_body_html: buildHtml('🚚 Em Trânsito', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Sua encomenda está viajando!</h1>
        <p style="color:#64748b;margin:0 0 16px;">O pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> já está em transporte e sendo movimentado pelas unidades logísticas. Fique tranquilo, estamos de olho!</p>
        <p style="color:#64748b;margin:0;">Rastreie em tempo real usando o botão abaixo.</p>
      `),
    },
    {
      step_number: 4,
      step_name: 'Em Trânsito (Engajamento)',
      step_description: 'D+3 — Manter cliente engajado durante o trânsito',
      trigger_type: 'day_offset',
      trigger_day_offset: 3,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '📍 Atualização do seu pedido #{numero_pedido}',
      email_body_html: buildHtml('📍 Atualização', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Seu pedido está progredindo!</h1>
        <p style="color:#64748b;margin:0 0 16px;">Seu pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> está sendo movimentado pelas centrais de distribuição dos Correios. Em breve chegará na unidade mais próxima da sua cidade.</p>
        <p style="color:#64748b;margin:0;">Clique no botão abaixo para acompanhar a localização em tempo real.</p>
      `),
    },
    {
      step_number: 5,
      step_name: 'Oferta Upsell (Em Trânsito)',
      step_description: 'D+4 — Oferta de recompra enquanto pedido está a caminho',
      trigger_type: 'day_offset',
      trigger_day_offset: 4,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '🎁 Oferta exclusiva pra você, {primeiro_nome}!',
      email_body_html: buildHtml('🎁 Oferta Exclusiva', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Enquanto seu pedido chega...</h1>
        <p style="color:#64748b;margin:0 0 16px;">Seu pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> ainda está a caminho. Enquanto isso, preparamos uma oferta especial para você!</p>
        <p style="color:#64748b;margin:0;">Acesse a página de rastreio e confira os produtos exclusivos disponíveis para você hoje.</p>
      `),
    },
    {
      step_number: 6,
      step_name: 'Em Trânsito (Retentativa)',
      step_description: 'D+6 — Atualização de localização para manter confiança',
      trigger_type: 'day_offset',
      trigger_day_offset: 6,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '🔄 Atualização de localização — Pedido #{numero_pedido}',
      email_body_html: buildHtml('🔄 Atualização', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Seu pedido continua em rota!</h1>
        <p style="color:#64748b;margin:0 0 16px;">O pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> está progredindo no trajeto. Envios pelos Correios podem levar até 10 dias úteis dependendo do destino — estamos acompanhando tudo por você!</p>
        <p style="color:#64748b;margin:0;">Acompanhe a movimentação em tempo real clicando abaixo.</p>
      `),
    },
    {
      step_number: 7,
      step_name: 'Saiu Para Entrega',
      step_description: 'Quando o status muda para "saiu_para_entrega"',
      trigger_type: 'status_change',
      trigger_day_offset: 7,
      tracking_status_trigger: 'saiu_para_entrega',
      is_active: true,
      email_subject: '🏠 Chegando hoje! Seu pedido #{numero_pedido} saiu para entrega',
      email_body_html: buildHtml('🏠 Saiu Para Entrega!', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Seu pedido saiu para entrega hoje! 🎉</h1>
        <p style="color:#64748b;margin:0 0 16px;">O pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> saiu para entrega e o entregador está a caminho. Certifique-se de ter alguém disponível para receber ou que o local de entrega esteja acessível.</p>
        <p style="color:#64748b;margin:0;">Acompanhe a entrega pelo link de rastreio.</p>
      `),
    },
    {
      step_number: 8,
      step_name: 'Erro de Entrega',
      step_description: 'Quando o status muda para "erro_entrega" — alerta ao cliente',
      trigger_type: 'status_change',
      trigger_day_offset: 8,
      tracking_status_trigger: 'erro_entrega',
      is_active: true,
      email_subject: '⚠️ Tentativa de entrega mal sucedida — Pedido #{numero_pedido}',
      email_body_html: buildHtml('⚠️ Problema na Entrega', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Tentativa de entrega sem sucesso</h1>
        <p style="color:#64748b;margin:0 0 16px;">Infelizmente o entregador não conseguiu completar a entrega do pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong>. Isso pode ocorrer por ausência, endereço incompleto ou portão fechado.</p>
        <div style="background:#1a0a0a;border:1px solid #7f1d1d;border-radius:12px;padding:16px;margin-bottom:16px;">
          <p style="color:#fca5a5;margin:0;font-size:13px;"><strong>O que fazer agora?</strong><br/>• Verifique se seu endereço de entrega está correto na página de rastreio;<br/>• Uma nova tentativa será realizada automaticamente;<br/>• Caso necessite, você pode solicitar retirada em agência.</p>
        </div>
      `),
    },
    {
      step_number: 9,
      step_name: 'Retentativa de Entrega',
      step_description: 'Quando o status muda para "retentativa" — nova tentativa',
      trigger_type: 'status_change',
      trigger_day_offset: 9,
      tracking_status_trigger: 'retentativa',
      is_active: true,
      email_subject: '🔄 Nova tentativa de entrega amanhã — Pedido #{numero_pedido}',
      email_body_html: buildHtml('🔄 Nova Tentativa', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Uma nova entrega será realizada!</h1>
        <p style="color:#64748b;margin:0 0 16px;">Boa notícia! Uma nova tentativa de entrega do pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> já está agendada. Certifique-se de estar disponível para receber ou que alguém de confiança esteja no endereço de entrega.</p>
        <p style="color:#64748b;margin:0;">Acompanhe o status atualizado clicando abaixo.</p>
      `),
    },
    {
      step_number: 10,
      step_name: 'Entregue com Sucesso',
      step_description: 'Quando o status muda para "entregue" — parabéns + avaliação',
      trigger_type: 'status_change',
      trigger_day_offset: 10,
      tracking_status_trigger: 'entregue',
      is_active: true,
      email_subject: '🎉 Pedido #{numero_pedido} entregue com sucesso!',
      email_body_html: buildHtml('🎉 Entregue!', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Seu pedido chegou! 🎉</h1>
        <p style="color:#64748b;margin:0 0 16px;">O pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> foi entregue com sucesso no endereço cadastrado. Esperamos que você adore!</p>
        <p style="color:#64748b;margin:0;">Aproveite sua compra e volte sempre. Sua satisfação é o que nos motiva! 💜</p>
      `),
    },
    {
      step_number: 11,
      step_name: 'Taxa Pendente (1ª Cobrança)',
      step_description: 'D+11 — Cobrança da taxa de serviço na página de rastreio',
      trigger_type: 'day_offset',
      trigger_day_offset: 11,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '⚠️ Taxa de serviço pendente — Pedido #{numero_pedido}',
      email_body_html: buildHtml('⚠️ Taxa Pendente', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Existe uma taxa de serviço em aberto</h1>
        <p style="color:#64748b;margin:0 0 16px;">Identificamos que há uma <strong style="color:#f59e0b;">taxa de serviço logístico</strong> pendente referente ao pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong>. Para regularizar, acesse sua página de rastreio clicando no botão abaixo.</p>
        <div style="background:#1a1200;border:1px solid #78350f;border-radius:12px;padding:16px;margin-bottom:16px;">
          <p style="color:#fcd34d;margin:0;font-size:13px;">⚠️ A regularização é necessária para garantir a continuidade dos serviços.</p>
        </div>
      `),
    },
    {
      step_number: 12,
      step_name: 'Taxa — 1ª Retentativa',
      step_description: 'D+12 — Lembrete urgente de taxa não paga',
      trigger_type: 'day_offset',
      trigger_day_offset: 12,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '🔴 URGENTE: Taxa de serviço vencendo — Pedido #{numero_pedido}',
      email_body_html: buildHtml('🔴 Atenção Urgente', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Sua taxa de serviço ainda está pendente!</h1>
        <p style="color:#64748b;margin:0 0 16px;">Esta é uma segunda notificação sobre a taxa de serviço logístico em aberto para o pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong>. O prazo para regularização está se esgotando.</p>
        <div style="background:#1a0000;border:1px solid #991b1b;border-radius:12px;padding:16px;margin-bottom:16px;">
          <p style="color:#fca5a5;margin:0;font-size:13px;"><strong>⚠️ Atenção:</strong> A não regularização dentro do prazo pode resultar em restrições no acesso ao sistema de rastreio.</p>
        </div>
        <p style="color:#64748b;margin:0;">Regularize agora pelo link de rastreio abaixo.</p>
      `),
    },
    {
      step_number: 13,
      step_name: 'Taxa — 2ª Retentativa',
      step_description: 'D+13 — Urgência máxima, prazo final',
      trigger_type: 'day_offset',
      trigger_day_offset: 13,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '🚨 ÚLTIMO AVISO: Taxa vence hoje — Pedido #{numero_pedido}',
      email_body_html: buildHtml('🚨 Último Aviso', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">ÚLTIMO AVISO — Taxa vence hoje!</h1>
        <p style="color:#64748b;margin:0 0 16px;">Este é o último aviso automático sobre a taxa de serviço logístico pendente do pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong>. O prazo se encerra hoje.</p>
        <div style="background:#1a0000;border:2px solid #dc2626;border-radius:12px;padding:16px;margin-bottom:16px;">
          <p style="color:#f87171;margin:0;font-size:14px;font-weight:700;">⛔ Após o vencimento, o acesso à página de rastreio poderá ser bloqueado automaticamente.</p>
        </div>
        <p style="color:#64748b;margin:0;">Regularize agora. Clique no botão abaixo.</p>
      `),
    },
    {
      step_number: 14,
      step_name: 'Taxa Não Paga — Escalação',
      step_description: 'D+14 — Comunicado de bloqueio por taxa em atraso',
      trigger_type: 'day_offset',
      trigger_day_offset: 14,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '⛔ Acesso ao rastreio restrito — Pedido #{numero_pedido}',
      email_body_html: buildHtml('⛔ Acesso Restrito', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">O acesso ao rastreio foi restrito</h1>
        <p style="color:#64748b;margin:0 0 16px;">Devido à taxa de serviço logístico em aberto do pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong>, o acesso completo à página de rastreio foi temporariamente restrito.</p>
        <div style="background:#1a0000;border:2px solid #dc2626;border-radius:12px;padding:16px;margin-bottom:16px;">
          <p style="color:#f87171;margin:0;font-size:13px;">Para restaurar o acesso completo, regularize sua pendência clicando no botão abaixo. O desbloqueio ocorre em até 1 hora após o pagamento.</p>
        </div>
      `),
    },
    {
      step_number: 15,
      step_name: 'Encerramento da Jornada',
      step_description: 'D+15 — Mensagem final de encerramento da jornada',
      trigger_type: 'day_offset',
      trigger_day_offset: 15,
      tracking_status_trigger: null,
      is_active: true,
      email_subject: '📋 Resumo final do seu pedido #{numero_pedido}',
      email_body_html: buildHtml('📋 Encerramento', `
        <p style="color:#94a3b8;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">{primeiro_nome}</strong>!</p>
        <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 12px;">Sua jornada de rastreio foi encerrada</h1>
        <p style="color:#64748b;margin:0 0 16px;">O ciclo de acompanhamento do pedido <strong style="color:#94a3b8;">#{numero_pedido}</strong> foi concluído. Esperamos que a experiência tenha sido ótima!</p>
        <p style="color:#64748b;margin:0 0 16px;">Caso ainda tenha alguma pendência, acesse a página de rastreio pelo botão abaixo.</p>
        <p style="color:#64748b;margin:0;">Obrigado por escolher a {nome_loja}! Até a próxima. 💜</p>
      `),
    },
  ];
}
