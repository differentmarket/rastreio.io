-- ==============================================================================
-- Rastreio.IO — FASE 6.2: Trava Idempotente Persistente & Ajustes de Configuração
-- ==============================================================================

-- 1. TABELA: ai_message_locks (Debounce persistente para Serverless / Multi-instância)
CREATE TABLE IF NOT EXISTS public.ai_message_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '2 minutes'),
  UNIQUE(store_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_message_locks_store ON public.ai_message_locks(store_id);
CREATE INDEX IF NOT EXISTS idx_ai_message_locks_expiration ON public.ai_message_locks(expires_at);

-- 2. CAMPOS ADICIONAIS EM ai_agents_config (Regras Comerciais e Instruções Específicas)
ALTER TABLE public.ai_agents_config 
ADD COLUMN IF NOT EXISTS commercial_rules TEXT;

-- 3. ROW LEVEL SECURITY (RLS) & POLICIES
ALTER TABLE public.ai_message_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on ai_message_locks" ON public.ai_message_locks;
CREATE POLICY "Service role full access on ai_message_locks"
  ON public.ai_message_locks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view ai_message_locks for their stores" ON public.ai_message_locks;
CREATE POLICY "Users can view ai_message_locks for their stores"
  ON public.ai_message_locks FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );
