-- ====================================================
-- Rastreio.IO — Migração Completa: Fila e Analytics de Recuperação
-- (Auto-contida: cria recovery_queue se não existir antes de referenciar)
-- ====================================================

-- 1. Tabela: recovery_queue (Fila dedicada para automações de recuperação)
CREATE TABLE IF NOT EXISTS public.recovery_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'cancelled', 'failed')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_queue_status_scheduled ON public.recovery_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_order_id ON public.recovery_queue(order_id);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_store_id ON public.recovery_queue(store_id);

-- Atualizar tabela stores com configurações de recuperação
ALTER TABLE public.stores
ADD COLUMN IF NOT EXISTS ai_recovery_delay_minutes INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS ai_initial_message TEXT,
ADD COLUMN IF NOT EXISTS ai_coupon_code TEXT;

-- 2. Tabela: recovery_revenue (Atribuição Financeira de Vendas Recuperadas)
CREATE TABLE IF NOT EXISTS public.recovery_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  queue_id UUID REFERENCES public.recovery_queue(id) ON DELETE SET NULL,
  customer_id UUID,
  valor_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  attribution_type TEXT NOT NULL DEFAULT 'whatsapp_recovery', -- 'whatsapp_recovery', 'email_recovery', 'coupon_recovery'
  tempo_minutos_ate_conversao INTEGER,
  sent_at TIMESTAMPTZ NOT NULL,
  recovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id) -- Impede dupla atribuição para o mesmo pedido
);

CREATE INDEX IF NOT EXISTS idx_recovery_revenue_store_id ON public.recovery_revenue(store_id);
CREATE INDEX IF NOT EXISTS idx_recovery_revenue_recovered_at ON public.recovery_revenue(recovered_at);
CREATE INDEX IF NOT EXISTS idx_recovery_revenue_store_recovered ON public.recovery_revenue(store_id, recovered_at);

-- 3. Tabela: recovery_events (Log de Micro-Eventos do Funil de Conversão)
CREATE TABLE IF NOT EXISTS public.recovery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  queue_id UUID REFERENCES public.recovery_queue(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'enqueued', 'processing', 'sent', 'delivered', 'read', 'link_clicked', 'converted', 'cancelled'
  channel TEXT DEFAULT 'whatsapp',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_events_store_id ON public.recovery_events(store_id);
CREATE INDEX IF NOT EXISTS idx_recovery_events_store_type ON public.recovery_events(store_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_recovery_events_order_id ON public.recovery_events(order_id);

-- 4. Tabela: recovery_templates (Régua de Recuperação e Follow-ups)
CREATE TABLE IF NOT EXISTS public.recovery_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  step_number INTEGER NOT NULL DEFAULT 1,
  delay_minutes INTEGER NOT NULL DEFAULT 30,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  template_text TEXT NOT NULL,
  coupon_code TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_templates_store_id ON public.recovery_templates(store_id);

-- 5. Habilitar Row Level Security (RLS) com Isolamento Multi-Tenant Estrito
ALTER TABLE public.recovery_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_templates ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS: Service Role (Bypass total para APIs do backend)
DROP POLICY IF EXISTS "Service role full access on recovery_queue" ON public.recovery_queue;
CREATE POLICY "Service role full access on recovery_queue"
  ON public.recovery_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on recovery_revenue" ON public.recovery_revenue;
CREATE POLICY "Service role full access on recovery_revenue"
  ON public.recovery_revenue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on recovery_events" ON public.recovery_events;
CREATE POLICY "Service role full access on recovery_events"
  ON public.recovery_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on recovery_templates" ON public.recovery_templates;
CREATE POLICY "Service role full access on recovery_templates"
  ON public.recovery_templates FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Políticas de RLS: Usuários Autenticados (Acesso estrito às suas lojas vinculadas)
DROP POLICY IF EXISTS "Users can view recovery_queue for their stores" ON public.recovery_queue;
CREATE POLICY "Users can view recovery_queue for their stores"
  ON public.recovery_queue FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view recovery_revenue for their stores" ON public.recovery_revenue;
CREATE POLICY "Users can view recovery_revenue for their stores"
  ON public.recovery_revenue FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view recovery_events for their stores" ON public.recovery_events;
CREATE POLICY "Users can view recovery_events for their stores"
  ON public.recovery_events FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view recovery_templates for their stores" ON public.recovery_templates;
CREATE POLICY "Users can view recovery_templates for their stores"
  ON public.recovery_templates FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );
