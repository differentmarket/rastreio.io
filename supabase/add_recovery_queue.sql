-- ====================================================
-- Rastreio.IO — Migração Fila de Recuperação de Vendas (recovery_queue)
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

-- Índices essenciais para alta performance e isolamento
CREATE INDEX IF NOT EXISTS idx_recovery_queue_status_scheduled ON public.recovery_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_order_id ON public.recovery_queue(order_id);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_store_id ON public.recovery_queue(store_id);

-- 2. Atualizar tabela stores com configurações de recuperação
ALTER TABLE public.stores
ADD COLUMN IF NOT EXISTS ai_recovery_delay_minutes INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS ai_initial_message TEXT,
ADD COLUMN IF NOT EXISTS ai_coupon_code TEXT;
