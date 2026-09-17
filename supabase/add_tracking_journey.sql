-- ==============================================================================
-- Rastreio.IO — Migração: Jornada de Rastreio de 15 Dias
-- Módulo: tracking_journey (independente do módulo de recovery/carrinho)
-- Idempotente: pode ser executado repetidamente sem erros
-- ==============================================================================

-- ==============================================================================
-- 1. EXPANDIR STATUS DA TABELA TRACKINGS
--    Adiciona 'erro_entrega' e 'retentativa' ao enum de status do rastreio
-- ==============================================================================

-- Obs: O status em trackings é TEXT, não ENUM, então basta documentar os novos
-- valores aceitos pela aplicação:
-- postado | em_transito | saiu_para_entrega | entregue | extraviado
-- [NOVOS] erro_entrega | retentativa

-- ==============================================================================
-- 2. TABELA: tracking_journey_steps
--    Define a configuração dos 15 passos da jornada por loja.
--    O lojista pode personalizar texto, ativar/desativar cada passo.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.tracking_journey_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,

  -- Identificação do step
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 15),
  step_name TEXT NOT NULL,                -- Ex: "Pedido Confirmado", "Taxa Pendente"
  step_description TEXT,                  -- Descrição interna para o lojista

  -- Condição que dispara este step
  trigger_type TEXT NOT NULL DEFAULT 'day_offset',
  -- Valores aceitos:
  --   'day_offset'       → Dispara X dias após o pedido (D+N)
  --   'status_change'    → Dispara quando o rastreio muda para tracking_status_trigger
  --   'status_and_day'   → Dispara em D+N E quando o status for tracking_status_trigger
  trigger_day_offset INTEGER DEFAULT 0,          -- D+ em relação a orders.created_at
  tracking_status_trigger TEXT DEFAULT NULL,     -- Ex: 'erro_entrega', 'entregue', 'saiu_para_entrega'

  -- Configuração do e-mail
  email_subject TEXT NOT NULL,            -- Assunto do e-mail
  email_body_html TEXT NOT NULL,          -- Template HTML completo (suporta variáveis {primeiro_nome}, {numero_pedido}, etc.)

  -- Controle
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(store_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_journey_steps_store_id ON public.tracking_journey_steps(store_id);
CREATE INDEX IF NOT EXISTS idx_journey_steps_store_step ON public.tracking_journey_steps(store_id, step_number);

-- ==============================================================================
-- 3. TABELA: tracking_journey_queue
--    Fila de jornadas ativas por pedido. Um registro por order_id.
--    Armazena qual step foi enviado por último e quando enviar o próximo.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.tracking_journey_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  -- Progresso
  current_step INTEGER NOT NULL DEFAULT 0,       -- Último step enviado (0 = nenhum)
  next_step INTEGER NOT NULL DEFAULT 1,          -- Próximo step a ser enviado
  next_send_at TIMESTAMPTZ,                      -- Data/hora programada para o próximo envio

  -- Status da jornada
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'failed')),

  -- Metadados
  order_created_at TIMESTAMPTZ NOT NULL,         -- Cópia de orders.created_at para calcular D+
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(order_id)  -- Um pedido só pode ter uma jornada ativa por vez
);

CREATE INDEX IF NOT EXISTS idx_journey_queue_store_id ON public.tracking_journey_queue(store_id);
CREATE INDEX IF NOT EXISTS idx_journey_queue_status_next ON public.tracking_journey_queue(status, next_send_at);
CREATE INDEX IF NOT EXISTS idx_journey_queue_order_id ON public.tracking_journey_queue(order_id);

-- ==============================================================================
-- 4. TABELA: tracking_journey_events
--    Log de auditoria de cada step enviado (ou tentado).
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.tracking_journey_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  queue_id UUID REFERENCES public.tracking_journey_queue(id) ON DELETE CASCADE,

  step_number INTEGER NOT NULL,
  step_name TEXT,
  event_type TEXT NOT NULL,  -- 'sent' | 'failed' | 'skipped' | 'enqueued' | 'completed'
  channel TEXT NOT NULL DEFAULT 'email',

  -- Resultado
  success BOOLEAN DEFAULT false,
  error_message TEXT,
  email_to TEXT,

  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journey_events_store_id ON public.tracking_journey_events(store_id);
CREATE INDEX IF NOT EXISTS idx_journey_events_order_id ON public.tracking_journey_events(order_id);
CREATE INDEX IF NOT EXISTS idx_journey_events_store_created ON public.tracking_journey_events(store_id, created_at);

-- ==============================================================================
-- 5. ROW LEVEL SECURITY
-- ==============================================================================
ALTER TABLE public.tracking_journey_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_journey_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_journey_events ENABLE ROW LEVEL SECURITY;

-- tracking_journey_steps: service_role acesso total
DROP POLICY IF EXISTS "Service role full access on tracking_journey_steps" ON public.tracking_journey_steps;
CREATE POLICY "Service role full access on tracking_journey_steps"
  ON public.tracking_journey_steps FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- tracking_journey_steps: lojistas gerenciam seus steps
DROP POLICY IF EXISTS "Users manage their journey steps" ON public.tracking_journey_steps;
CREATE POLICY "Users manage their journey steps"
  ON public.tracking_journey_steps FOR ALL TO authenticated
  USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()))
  WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()));

-- tracking_journey_queue: service_role acesso total
DROP POLICY IF EXISTS "Service role full access on tracking_journey_queue" ON public.tracking_journey_queue;
CREATE POLICY "Service role full access on tracking_journey_queue"
  ON public.tracking_journey_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- tracking_journey_queue: lojistas visualizam suas filas
DROP POLICY IF EXISTS "Users view their journey queue" ON public.tracking_journey_queue;
CREATE POLICY "Users view their journey queue"
  ON public.tracking_journey_queue FOR SELECT TO authenticated
  USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()));

-- tracking_journey_events: service_role acesso total
DROP POLICY IF EXISTS "Service role full access on tracking_journey_events" ON public.tracking_journey_events;
CREATE POLICY "Service role full access on tracking_journey_events"
  ON public.tracking_journey_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- tracking_journey_events: lojistas visualizam seus eventos
DROP POLICY IF EXISTS "Users view their journey events" ON public.tracking_journey_events;
CREATE POLICY "Users view their journey events"
  ON public.tracking_journey_events FOR SELECT TO authenticated
  USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()));

-- ==============================================================================
-- 6. TRIGGER: updated_at automático para journey_steps e journey_queue
-- ==============================================================================
-- Reutiliza a função set_updated_at() já existente no schema base

DROP TRIGGER IF EXISTS trg_journey_steps_updated_at ON public.tracking_journey_steps;
CREATE TRIGGER trg_journey_steps_updated_at
  BEFORE UPDATE ON public.tracking_journey_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_journey_queue_updated_at ON public.tracking_journey_queue;
CREATE TRIGGER trg_journey_queue_updated_at
  BEFORE UPDATE ON public.tracking_journey_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
