-- ==============================================================================
-- Rastreio.IO — FASE 6.1: Banco de Dados & RLS do Agente Conversacional WhatsApp
-- ==============================================================================

-- 1. TABELA: ai_agents_config (Configuração da IA por Loja)
CREATE TABLE IF NOT EXISTS public.ai_agents_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  is_enabled BOOLEAN DEFAULT true,
  ai_model TEXT DEFAULT 'gpt-4o-mini',
  ai_temperature NUMERIC DEFAULT 0.7,
  ai_tone TEXT DEFAULT 'amigavel', -- 'amigavel', 'vendedor', 'formal', 'empatico'
  system_prompt_custom TEXT,
  max_turns_before_handoff INTEGER DEFAULT 10,
  max_discount_percent INTEGER DEFAULT 0, -- Controle comercial estrito
  auto_discount_enabled BOOLEAN DEFAULT true,
  discount_coupon_code TEXT,
  human_support_phone TEXT,
  operating_hours JSONB DEFAULT '{}'::jsonb,
  handoff_triggers TEXT[] DEFAULT ARRAY['humano', 'atendente', 'suporte', 'falar com pessoa', 'atendente humano']::text[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_config_store_id ON public.ai_agents_config(store_id);

-- 2. TABELA: ai_conversations (Sessões de Atendimento WhatsApp / Multicanal)
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'ai_active' CHECK (status IN ('ai_active', 'human_takeover', 'resolved', 'blocked')),
  last_intent TEXT,
  intent_confidence NUMERIC, -- Confiança da classificação da IA (0.00 a 1.00)
  conversation_summary TEXT, -- Memória resumida para conversas longas
  unread_messages_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, customer_phone)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_store_id ON public.ai_conversations(store_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_status ON public.ai_conversations(store_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_phone ON public.ai_conversations(store_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_last_msg ON public.ai_conversations(store_id, last_message_at DESC);

-- 3. TABELA: ai_messages (Histórico de Mensagens Individuais da Conversa)
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE, -- Desnormalização para queries diretas ultrarrápidas e RLS
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'ai', 'human')),
  sender_name TEXT,
  message_text TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir coluna store_id caso a tabela já existisse
ALTER TABLE public.ai_messages
ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_id ON public.ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_store_id ON public.ai_messages(store_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON public.ai_messages(conversation_id, created_at ASC);

-- 4. TABELA: ai_handoff_events (Auditoria de Transição para Atendente Humano)
CREATE TABLE IF NOT EXISTS public.ai_handoff_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  reason TEXT NOT NULL, -- 'keyword_trigger', 'client_requested', 'max_turns_reached', 'manual_takeover'
  triggered_by TEXT NOT NULL DEFAULT 'system' CHECK (triggered_by IN ('system', 'client', 'ai', 'agent_user')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_handoff_store_id ON public.ai_handoff_events(store_id);
CREATE INDEX IF NOT EXISTS idx_ai_handoff_conv_id ON public.ai_handoff_events(conversation_id);

-- ==============================================================================
-- 5. ROW LEVEL SECURITY (RLS) & POLICIES MULTI-TENANT
-- ==============================================================================

ALTER TABLE public.ai_agents_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_handoff_events ENABLE ROW LEVEL SECURITY;

-- 5.1. ai_agents_config
DROP POLICY IF EXISTS "Service role full access on ai_agents_config" ON public.ai_agents_config;
CREATE POLICY "Service role full access on ai_agents_config"
  ON public.ai_agents_config FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view ai_agents_config for their stores" ON public.ai_agents_config;
CREATE POLICY "Users can view ai_agents_config for their stores"
  ON public.ai_agents_config FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Only owners can update ai_agents_config" ON public.ai_agents_config;
CREATE POLICY "Only owners can update ai_agents_config"
  ON public.ai_agents_config FOR ALL
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'owner'
    )
  )
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- 5.2. ai_conversations
DROP POLICY IF EXISTS "Service role full access on ai_conversations" ON public.ai_conversations;
CREATE POLICY "Service role full access on ai_conversations"
  ON public.ai_conversations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can manage ai_conversations for their stores" ON public.ai_conversations;
CREATE POLICY "Users can manage ai_conversations for their stores"
  ON public.ai_conversations FOR ALL
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

-- 5.3. ai_messages
DROP POLICY IF EXISTS "Service role full access on ai_messages" ON public.ai_messages;
CREATE POLICY "Service role full access on ai_messages"
  ON public.ai_messages FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view ai_messages for their store conversations" ON public.ai_messages;
CREATE POLICY "Users can view ai_messages for their store conversations"
  ON public.ai_messages FOR SELECT
  TO authenticated
  USING (
    (store_id IS NOT NULL AND store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    ))
    OR
    conversation_id IN (
      SELECT c.id FROM public.ai_conversations c
      JOIN public.store_users su ON su.store_id = c.store_id
      WHERE su.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert ai_messages for their store conversations" ON public.ai_messages;
CREATE POLICY "Users can insert ai_messages for their store conversations"
  ON public.ai_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    (store_id IS NOT NULL AND store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    ))
    OR
    conversation_id IN (
      SELECT c.id FROM public.ai_conversations c
      JOIN public.store_users su ON su.store_id = c.store_id
      WHERE su.user_id = auth.uid()
    )
  );

-- 5.4. ai_handoff_events
DROP POLICY IF EXISTS "Service role full access on ai_handoff_events" ON public.ai_handoff_events;
CREATE POLICY "Service role full access on ai_handoff_events"
  ON public.ai_handoff_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view ai_handoff_events for their stores" ON public.ai_handoff_events;
CREATE POLICY "Users can view ai_handoff_events for their stores"
  ON public.ai_handoff_events FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert ai_handoff_events for their stores" ON public.ai_handoff_events;
CREATE POLICY "Users can insert ai_handoff_events for their stores"
  ON public.ai_handoff_events FOR INSERT
  TO authenticated
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );
