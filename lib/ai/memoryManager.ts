import { supabaseAdmin } from '@/lib/supabaseAdmin';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  sender_type?: 'customer' | 'ai' | 'human';
  created_at?: string;
}

export interface ConversationSession {
  id: string;
  store_id: string;
  customer_phone: string;
  customer_name?: string;
  status: 'ai_active' | 'human_takeover' | 'resolved' | 'blocked';
  last_intent?: string;
  intent_confidence?: number;
  conversation_summary?: string;
  unread_messages_count: number;
  order_id?: string;
}

/**
 * Obtém ou cria uma sessão de conversa para o cliente na loja indicada.
 */
export async function getOrCreateConversation(
  storeId: string,
  customerPhone: string,
  initialData?: { customerName?: string; orderId?: string }
): Promise<ConversationSession | null> {
  const cleanPhone = customerPhone.replace(/\D/g, '');

  try {
    // 1. Tenta buscar conversa existente
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('ai_conversations')
      .select('*')
      .eq('store_id', storeId)
      .eq('customer_phone', cleanPhone)
      .maybeSingle();

    if (findErr) {
      console.error('Erro ao buscar conversa no memoryManager:', findErr);
    }

    if (existing) {
      // Se houver novos dados de cliente ou pedido, atualiza
      if (
        (initialData?.customerName && !existing.customer_name) ||
        (initialData?.orderId && !existing.order_id)
      ) {
        await supabaseAdmin
          .from('ai_conversations')
          .update({
            customer_name: existing.customer_name || initialData?.customerName,
            order_id: existing.order_id || initialData?.orderId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      }
      return existing as ConversationSession;
    }

    // 2. Cria nova conversa
    const { data: created, error: insertErr } = await supabaseAdmin
      .from('ai_conversations')
      .insert({
        store_id: storeId,
        customer_phone: cleanPhone,
        customer_name: initialData?.customerName || null,
        order_id: initialData?.orderId || null,
        channel: 'whatsapp',
        status: 'ai_active',
        unread_messages_count: 0,
      })
      .select('*')
      .single();

    if (insertErr) {
      // Fallback em caso de concorrência: tenta buscar novamente
      const { data: fallback } = await supabaseAdmin
        .from('ai_conversations')
        .select('*')
        .eq('store_id', storeId)
        .eq('customer_phone', cleanPhone)
        .maybeSingle();

      return fallback as ConversationSession;
    }

    return created as ConversationSession;
  } catch (err) {
    console.error('Exceção em getOrCreateConversation:', err);
    return null;
  }
}

/**
 * Registra uma mensagem na tabela ai_messages vinculada à conversa e à loja.
 */
export async function appendMessage(params: {
  conversationId: string;
  storeId: string;
  senderType: 'customer' | 'ai' | 'human';
  senderName?: string;
  messageText: string;
  tokensUsed?: number;
  metadata?: Record<string, any>;
}): Promise<void> {
  const { conversationId, storeId, senderType, senderName, messageText, tokensUsed = 0, metadata = {} } = params;

  try {
    await supabaseAdmin.from('ai_messages').insert({
      conversation_id: conversationId,
      store_id: storeId,
      sender_type: senderType,
      sender_name: senderName || (senderType === 'customer' ? 'Cliente' : senderType === 'ai' ? 'IA' : 'Atendente'),
      message_text: messageText,
      tokens_used: tokensUsed,
      metadata,
    });

    // Atualiza last_message_at na conversa
    await supabaseAdmin
      .from('ai_conversations')
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
  } catch (err) {
    console.error('Erro ao gravar ai_message:', err);
  }
}

/**
 * Carrega o histórico recente de mensagens para alimentar o contexto do LLM.
 */
export async function getConversationHistory(
  conversationId: string,
  limit: number = 8
): Promise<ChatMessage[]> {
  try {
    const { data: messages, error } = await supabaseAdmin
      .from('ai_messages')
      .select('sender_type, message_text, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !messages) return [];

    // Reverte para ordem cronológica (mais antigas primeiro)
    return messages.reverse().map((msg) => ({
      role: msg.sender_type === 'customer' ? 'user' : 'assistant',
      content: msg.message_text,
      sender_type: msg.sender_type as any,
      created_at: msg.created_at,
    }));
  } catch (err) {
    console.error('Erro ao buscar histórico em getConversationHistory:', err);
    return [];
  }
}

/**
 * Transfere a conversa para atendimento humano (handoff).
 */
export async function triggerHandoff(params: {
  conversationId: string;
  storeId: string;
  reason: string;
  triggeredBy: 'system' | 'client' | 'ai' | 'agent_user';
  metadata?: Record<string, any>;
}): Promise<void> {
  const { conversationId, storeId, reason, triggeredBy, metadata = {} } = params;

  try {
    // 1. Atualiza status na conversa
    await supabaseAdmin
      .from('ai_conversations')
      .update({
        status: 'human_takeover',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    // 2. Registra evento de auditoria
    await supabaseAdmin.from('ai_handoff_events').insert({
      conversation_id: conversationId,
      store_id: storeId,
      reason,
      triggered_by: triggeredBy,
      metadata,
    });
  } catch (err) {
    console.error('Erro ao registrar handoff no memoryManager:', err);
  }
}

/**
 * Mecanismo de retomada: Reativa a IA após intervenção ou atendimento humano.
 */
export async function resumeAiConversation(
  storeId: string,
  conversationId: string,
  resumedBy: string = 'agent_user'
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from('ai_conversations')
      .update({
        status: 'ai_active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
      .eq('store_id', storeId);

    if (error) {
      console.error('Erro ao retomar conversa para IA:', error);
      return false;
    }

    // Registra evento de retomada
    await supabaseAdmin.from('ai_handoff_events').insert({
      conversation_id: conversationId,
      store_id: storeId,
      reason: 'conversation_resumed_to_ai',
      triggered_by: 'agent_user',
      metadata: { resumed_by: resumedBy, resumed_at: new Date().toISOString() },
    });

    return true;
  } catch (err) {
    console.error('Exceção ao retomar conversa para IA:', err);
    return false;
  }
}
