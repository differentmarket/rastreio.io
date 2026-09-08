import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { classifyIntent } from './intentClassifier';
import {
  getOrCreateConversation,
  appendMessage,
  getConversationHistory,
  triggerHandoff,
  ChatMessage,
} from './memoryManager';
import { buildSystemPrompt, StoreAiConfig } from './contextBuilder';
import { trackingTool, orderTool, paymentTool, productTool } from './tools';
import { sendWhatsAppReply } from '@/lib/whatsapp';

export interface OrchestratorParams {
  storeId: string;
  remoteJid: string;
  messageId: string;
  messageText: string;
  fromMe: boolean;
  customerName?: string;
  instanceName?: string;
}

export interface OrchestratorResult {
  status:
    | 'ignored_from_me'
    | 'duplicate_locked'
    | 'human_takeover_active'
    | 'handoff_triggered'
    | 'processed'
    | 'error';
  responseSent?: string;
  intent?: string;
  error?: string;
}

/**
 * Utilitário com timeout e retry controlado para serviços externos (OpenAI e Evolution API)
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
  timeoutMs = 8000
): Promise<Response> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok || res.status < 500) {
        return res; // Não faz retry em 4xx, apenas em timeouts ou 5xx
      }
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;
    }

    // Espera antes da próxima tentativa
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError || new Error(`Falha após ${maxRetries + 1} tentativas.`);
}

/**
 * Tenta adquirir lock persistente no banco de dados para evitar concorrência serverless.
 */
export async function acquireMessageLock(
  storeId: string,
  messageId: string,
  remoteJid: string
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from('ai_message_locks').insert({
      store_id: storeId,
      message_id: messageId,
      remote_jid: remoteJid,
      status: 'processing',
    });

    if (error) {
      // Código PostgreSQL 23505 = unique_violation
      if (error.code === '23505' || error.message.includes('unique constraint')) {
        return false;
      }
      console.warn('Alerta ao criar lock de mensagem:', error.message);
      return true; // Prossegue com fallback seguro caso a tabela de lock esteja temporariamente indisponível
    }

    return true;
  } catch (err) {
    console.error('Exceção ao adquirir lock:', err);
    return true;
  }
}

/**
 * Libera ou finaliza o lock persistente no banco.
 */
export async function releaseMessageLock(
  storeId: string,
  messageId: string,
  status: 'completed' | 'failed'
): Promise<void> {
  try {
    await supabaseAdmin
      .from('ai_message_locks')
      .update({ status })
      .eq('store_id', storeId)
      .eq('message_id', messageId);
  } catch (err) {
    console.error('Erro ao atualizar status do lock:', err);
  }
}

/**
 * Orquestrador Central da IA do WhatsApp (FASE 6.2).
 */
export async function orchestrateAiMessage(
  params: OrchestratorParams
): Promise<OrchestratorResult> {
  const { storeId, remoteJid, messageId, messageText, fromMe, customerName, instanceName } = params;

  // 1. Anti-loop rigoroso: mensagens geradas pelo próprio bot/atendente são descartadas
  if (fromMe) {
    return { status: 'ignored_from_me' };
  }

  // 2. Debounce Persistente Serverless: adquire lock no Supabase
  const lockAcquired = await acquireMessageLock(storeId, messageId, remoteJid);
  if (!lockAcquired) {
    return { status: 'duplicate_locked' };
  }

  try {
    // 3. Carrega configurações da loja e do agente de IA
    const [storeRes, agentConfigRes] = await Promise.all([
      supabaseAdmin
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .maybeSingle(),
      supabaseAdmin
        .from('ai_agents_config')
        .select('*')
        .eq('store_id', storeId)
        .maybeSingle(),
    ]);

    const store = storeRes.data;
    if (!store) {
      await releaseMessageLock(storeId, messageId, 'failed');
      return { status: 'error', error: 'Loja não localizada.' };
    }

    const agentConfig = agentConfigRes.data || {};
    if (agentConfig.is_enabled === false) {
      await releaseMessageLock(storeId, messageId, 'completed');
      return { status: 'error', error: 'Agente de IA desativado para esta loja.' };
    }

    const phoneClean = remoteJid.split('@')[0];

    // 4. Obtém ou cria sessão de conversa multi-turn
    const conversation = await getOrCreateConversation(storeId, phoneClean, {
      customerName,
    });

    if (!conversation) {
      await releaseMessageLock(storeId, messageId, 'failed');
      return { status: 'error', error: 'Falha ao obter sessão de conversa.' };
    }

    // 5. Verifica se a conversa está em Atendimento Humano (Human Takeover)
    if (conversation.status === 'human_takeover') {
      // Grava a mensagem do cliente no histórico para visualização do atendente humano
      await appendMessage({
        conversationId: conversation.id,
        storeId,
        senderType: 'customer',
        senderName: customerName || conversation.customer_name || 'Cliente',
        messageText,
      });

      await releaseMessageLock(storeId, messageId, 'completed');
      return { status: 'human_takeover_active' };
    }

    // 6. Classifica a intenção da mensagem
    const customHandoff = agentConfig.handoff_triggers || [];
    const intentResult = classifyIntent(messageText, customHandoff);

    // 7. Fluxo de Handoff Humano acionado
    if (intentResult.isHandoff) {
      await appendMessage({
        conversationId: conversation.id,
        storeId,
        senderType: 'customer',
        senderName: customerName || conversation.customer_name || 'Cliente',
        messageText,
      });

      await triggerHandoff({
        conversationId: conversation.id,
        storeId,
        reason: `Gatilho detectado: ${intentResult.extractedKeywords.join(', ') || 'solicitação do cliente'}`,
        triggeredBy: 'client',
        metadata: { intent: intentResult.intent, messageId },
      });

      const supportPhone = agentConfig.human_support_phone || store.whatsapp_suporte || 'nosso suporte';
      const handoffMessage = `Entendido! Estou transferindo seu atendimento para um de nossos especialistas humanos. Em breve nossa equipe responderá por aqui ou você pode nos contatar no número: ${supportPhone}.`;

      // Envia mensagem de transferência via WhatsApp Router (multi-provider com fallback Evolution)
      await sendWhatsAppReply({
        storeId,
        store,
        phone: phoneClean,
        text: handoffMessage,
        instanceName,
      });

      // Salva mensagem no histórico
      await appendMessage({
        conversationId: conversation.id,
        storeId,
        senderType: 'ai',
        senderName: 'IA (Handoff)',
        messageText: handoffMessage,
      });

      await releaseMessageLock(storeId, messageId, 'completed');
      return {
        status: 'handoff_triggered',
        responseSent: handoffMessage,
        intent: intentResult.intent,
      };
    }

    // 8. Execução estruturada das AI Tools (a IA nunca consulta o banco diretamente)
    // 8.1. Consulta de Pedido
    const orderRes = await orderTool(storeId, {
      customerPhone: phoneClean,
      orderId: conversation.order_id,
    });

    const activeOrder = orderRes.found ? orderRes.data : null;
    const activeOrderId = activeOrder?.id || conversation.order_id;

    // 8.2. Consulta de Rastreio (se houver pedido ou se a intenção for rastreamento)
    let trackingRes: import('./tools').ToolResult<import('./tools').TrackingData> = {
      found: false,
      data: null,
      reason: 'Não consultado',
    };
    if (activeOrderId || intentResult.intent === 'tracking_status') {
      trackingRes = await trackingTool(storeId, {
        orderId: activeOrderId,
        orderNumber: activeOrder?.numero_pedido,
      });
    }

    // 8.3. Consulta de Pagamento (se for dúvida de pagamento)
    let paymentRes: import('./tools').ToolResult<import('./tools').PaymentData> = {
      found: false,
      data: null,
      reason: 'Não consultado',
    };
    if (activeOrderId && (intentResult.intent === 'payment_doubt' || intentResult.intent === 'order_status')) {
      paymentRes = await paymentTool(storeId, {
        orderId: activeOrderId,
        requestedDiscountPercent: 10,
      });
    }

    // 8.4. Consulta de Produtos
    let productRes: import('./tools').ToolResult<import('./tools').ProductData> = {
      found: false,
      data: null,
      reason: 'Não consultado',
    };
    if (activeOrderId && intentResult.intent === 'product_doubt') {
      productRes = await productTool(storeId, { orderId: activeOrderId });
    }

    // 9. Persiste a mensagem do cliente
    await appendMessage({
      conversationId: conversation.id,
      storeId,
      senderType: 'customer',
      senderName: customerName || conversation.customer_name || 'Cliente',
      messageText,
    });

    // 10. Carrega histórico multi-turn
    const history = await getConversationHistory(conversation.id, 8);

    // 11. Monta contexto seguro e system prompt
    const storeConfig: StoreAiConfig = {
      nome_loja: store.nome_loja,
      whatsapp_suporte: agentConfig.human_support_phone || store.whatsapp_suporte,
      ai_tone: agentConfig.ai_tone || store.ai_tone,
      system_prompt_custom: agentConfig.system_prompt_custom || store.ai_prompt_custom,
      commercial_rules: agentConfig.commercial_rules,
      max_discount_percent: agentConfig.max_discount_percent,
      discount_coupon_code: agentConfig.discount_coupon_code || store.ai_coupon_code,
    };

    const systemPrompt = buildSystemPrompt({
      storeConfig,
      customerName: customerName || activeOrder?.customer_name || 'Cliente',
      order: activeOrder,
      tracking: trackingRes.data,
      payment: paymentRes.data,
      products: productRes.data,
      conversationSummary: conversation.conversation_summary,
    });

    // 12. Geração da Resposta com OpenAI e Fallback Controlado
    const apiKey = store.openai_api_key || process.env.OPENAI_API_KEY;
    const targetModel = agentConfig.ai_model || store.ai_model || 'gpt-4o-mini';
    const targetTemp = typeof agentConfig.ai_temperature === 'number' ? agentConfig.ai_temperature : 0.7;

    let generatedResponse = `Olá! Sou o assistente da ${store.nome_loja}. Como posso ajudar com sua compra ou entrega hoje?`;

    if (apiKey) {
      try {
        const messagesPayload: any[] = [{ role: 'system', content: systemPrompt }];

        // Adiciona histórico anterior (excluindo a última mensagem pois já estará no user prompt)
        const previousTurns = history.slice(0, -1);
        for (const turn of previousTurns) {
          messagesPayload.push({
            role: turn.role,
            content: turn.content,
          });
        }

        // Mensagem atual do cliente
        messagesPayload.push({ role: 'user', content: messageText });

        const openAiRes = await fetchWithRetry(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: targetModel,
              messages: messagesPayload,
              temperature: targetTemp,
              max_tokens: 350,
            }),
          },
          2, // 2 retries
          8000 // 8s timeout
        );

        const openAiData = await openAiRes.json();
        if (openAiData?.choices?.[0]?.message?.content) {
          generatedResponse = openAiData.choices[0].message.content.trim();
        }
      } catch (errAi: any) {
        console.error('Erro na chamada da OpenAI (usando fallback seguro):', errAi.message || errAi);
        // Fallback contextualizado sem quebrar o atendimento
        if (trackingRes.found && trackingRes.data?.link_rastreio) {
          generatedResponse = `Olá! Para acompanhar a entrega do seu pedido em tempo real, acesse o link oficial de rastreamento: ${trackingRes.data.link_rastreio}`;
        } else {
          generatedResponse = `Olá! Recebi sua mensagem sobre o pedido. Estou consultando os detalhes e já retorno para te ajudar. Caso queira falar com nossa equipe, avise por aqui.`;
        }
      }
    }

    // 13. Envia a resposta via WhatsApp Router com Retry e Prioridade
    await sendWhatsAppReply({
      storeId,
      store,
      phone: phoneClean,
      text: generatedResponse,
      instanceName,
    });

    // 14. Persiste a resposta da IA no histórico
    await appendMessage({
      conversationId: conversation.id,
      storeId,
      senderType: 'ai',
      senderName: 'IA Oficial',
      messageText: generatedResponse,
    });

    // 15. Libera lock como completado
    await releaseMessageLock(storeId, messageId, 'completed');

    return {
      status: 'processed',
      responseSent: generatedResponse,
      intent: intentResult.intent,
    };
  } catch (err: any) {
    console.error('Erro geral no orchestrator:', err);
    await releaseMessageLock(storeId, messageId, 'failed');
    return {
      status: 'error',
      error: err.message || 'Erro inesperado no orquestrador de IA.',
    };
  }
}
