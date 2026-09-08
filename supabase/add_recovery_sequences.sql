-- ====================================================
-- Rastreio.IO — Migração Régua Inteligente de Recuperação (Sequências & Follow-ups)
-- ====================================================

-- 1. Tabela: recovery_steps (Configuração dos passos da régua por loja)
CREATE TABLE IF NOT EXISTS public.recovery_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 5), -- Limite de até 5 passos por loja
  delay_minutes INTEGER NOT NULL DEFAULT 30,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  template_text TEXT,
  coupon_code TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_recovery_steps_store_id ON public.recovery_steps(store_id);
CREATE INDEX IF NOT EXISTS idx_recovery_steps_store_step ON public.recovery_steps(store_id, step_number);

-- 2. Atualizar recovery_queue para controle sequencial
ALTER TABLE public.recovery_queue
ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS last_sent_step INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_recovery_queue_next_action ON public.recovery_queue(status, next_action_at);

-- 3. Atualizar recovery_revenue para registrar qual step converteu
ALTER TABLE public.recovery_revenue
ADD COLUMN IF NOT EXISTS step_number INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_recovery_revenue_step ON public.recovery_revenue(store_id, step_number);

-- 4. Habilitar RLS em recovery_steps com isolamento multi-tenant
ALTER TABLE public.recovery_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on recovery_steps" ON public.recovery_steps;
CREATE POLICY "Service role full access on recovery_steps"
  ON public.recovery_steps FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can manage recovery_steps for their stores" ON public.recovery_steps;
CREATE POLICY "Users can manage recovery_steps for their stores"
  ON public.recovery_steps FOR ALL
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
