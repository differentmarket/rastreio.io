-- ==============================================================================
-- Rastreio.IO — MASTER CONSOLIDATED DATABASE MIGRATION
-- Módulo: Recuperação de Vendas, Régua Inteligente, Analytics & Templates
-- 
-- Características:
-- - 100% Idempotente (pode rodar repetidas vezes sem falhas)
-- - Não-destrutiva (preserva dados em tabelas já populadas)
-- - Compatível com Supabase SQL Editor
-- ==============================================================================

-- ==============================================================================
-- 1. EXTENSIONS
-- ==============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. STORES CONFIGURATION
-- ==============================================================================
ALTER TABLE public.stores
ADD COLUMN IF NOT EXISTS ai_recovery_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_recovery_delay_minutes INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS ai_initial_message TEXT,
ADD COLUMN IF NOT EXISTS ai_coupon_code TEXT;

-- ==============================================================================
-- 3. RECOVERY QUEUE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.recovery_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir colunas de controle da régua sequencial em recovery_queue
ALTER TABLE public.recovery_queue
ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS last_sent_step INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ;

-- Atualizar restrição de status sem quebrar banco já populado
ALTER TABLE public.recovery_queue DROP CONSTRAINT IF EXISTS recovery_queue_status_check;
ALTER TABLE public.recovery_queue 
ADD CONSTRAINT recovery_queue_status_check 
CHECK (status IN ('pending', 'processing', 'sent', 'cancelled', 'failed', 'completed'));

-- Índices de alta performance e concorrência para o Cron Worker
CREATE INDEX IF NOT EXISTS idx_recovery_queue_status_scheduled ON public.recovery_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_next_action ON public.recovery_queue(status, next_action_at);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_order_id ON public.recovery_queue(order_id);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_store_id ON public.recovery_queue(store_id);

-- ==============================================================================
-- 4. RECOVERY SEQUENCES (RECOVERY_STEPS)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.recovery_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 5), -- Limite de até 5 passos
  step_name TEXT,
  delay_minutes INTEGER NOT NULL DEFAULT 30,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  template_text TEXT,
  coupon_code TEXT,
  is_active BOOLEAN DEFAULT true,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, step_number)
);

-- Garantir colunas adicionais em recovery_steps se a tabela já existia
ALTER TABLE public.recovery_steps
ADD COLUMN IF NOT EXISTS step_name TEXT,
ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_recovery_steps_store_id ON public.recovery_steps(store_id);
CREATE INDEX IF NOT EXISTS idx_recovery_steps_store_step ON public.recovery_steps(store_id, step_number);

-- ==============================================================================
-- 5. RECOVERY REVENUE & ANALYTICS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.recovery_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  queue_id UUID REFERENCES public.recovery_queue(id) ON DELETE SET NULL,
  customer_id UUID,
  valor_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  attribution_type TEXT NOT NULL DEFAULT 'whatsapp_recovery',
  step_number INTEGER DEFAULT 1,
  tempo_minutos_ate_conversao INTEGER,
  sent_at TIMESTAMPTZ NOT NULL,
  recovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id) -- Impede dupla atribuição do mesmo pedido
);

-- Garantir coluna step_number caso recovery_revenue já existisse
ALTER TABLE public.recovery_revenue
ADD COLUMN IF NOT EXISTS step_number INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_recovery_revenue_store_id ON public.recovery_revenue(store_id);
CREATE INDEX IF NOT EXISTS idx_recovery_revenue_recovered_at ON public.recovery_revenue(recovered_at);
CREATE INDEX IF NOT EXISTS idx_recovery_revenue_store_recovered ON public.recovery_revenue(store_id, recovered_at);
CREATE INDEX IF NOT EXISTS idx_recovery_revenue_step ON public.recovery_revenue(store_id, step_number);

-- ==============================================================================
-- 6. RECOVERY EVENTS (LOG DO FUNIL)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.recovery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  queue_id UUID REFERENCES public.recovery_queue(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'enqueued', 'processing', 'sent', 'step_sent', 'step_failed', 'delivered', 'read', 'converted', 'cancelled'
  channel TEXT DEFAULT 'whatsapp',
  step_number INTEGER DEFAULT 1,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir coluna step_number caso recovery_events já existisse
ALTER TABLE public.recovery_events
ADD COLUMN IF NOT EXISTS step_number INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_recovery_events_store_id ON public.recovery_events(store_id);
CREATE INDEX IF NOT EXISTS idx_recovery_events_store_type ON public.recovery_events(store_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_recovery_events_order_id ON public.recovery_events(order_id);

-- ==============================================================================
-- 7. TEMPLATE LIBRARY
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.recovery_template_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche TEXT NOT NULL,
  niche_label TEXT NOT NULL,
  icon TEXT DEFAULT 'ShoppingBag',
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 5),
  step_name TEXT NOT NULL,
  default_delay_minutes INTEGER NOT NULL DEFAULT 30,
  default_template_text TEXT NOT NULL,
  default_coupon_code TEXT,
  is_system_template BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(niche, step_number)
);

CREATE INDEX IF NOT EXISTS idx_template_library_niche ON public.recovery_template_library(niche);

-- ==============================================================================
-- 8. SECURITY POLICIES & RLS
-- ==============================================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE public.recovery_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_template_library ENABLE ROW LEVEL SECURITY;

-- 8.1. recovery_queue
DROP POLICY IF EXISTS "Service role full access on recovery_queue" ON public.recovery_queue;
CREATE POLICY "Service role full access on recovery_queue"
  ON public.recovery_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view recovery_queue for their stores" ON public.recovery_queue;
CREATE POLICY "Users can view recovery_queue for their stores"
  ON public.recovery_queue FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

-- 8.2. recovery_steps
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

-- 8.3. recovery_revenue
DROP POLICY IF EXISTS "Service role full access on recovery_revenue" ON public.recovery_revenue;
CREATE POLICY "Service role full access on recovery_revenue"
  ON public.recovery_revenue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view recovery_revenue for their stores" ON public.recovery_revenue;
CREATE POLICY "Users can view recovery_revenue for their stores"
  ON public.recovery_revenue FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

-- 8.4. recovery_events
DROP POLICY IF EXISTS "Service role full access on recovery_events" ON public.recovery_events;
CREATE POLICY "Service role full access on recovery_events"
  ON public.recovery_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view recovery_events for their stores" ON public.recovery_events;
CREATE POLICY "Users can view recovery_events for their stores"
  ON public.recovery_events FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

-- 8.5. recovery_template_library
DROP POLICY IF EXISTS "Service role full access on recovery_template_library" ON public.recovery_template_library;
CREATE POLICY "Service role full access on recovery_template_library"
  ON public.recovery_template_library FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can only read system templates" ON public.recovery_template_library;
CREATE POLICY "Authenticated users can only read system templates"
  ON public.recovery_template_library FOR SELECT
  TO authenticated
  USING (is_system_template = true);

-- ==============================================================================
-- 9. SEED DATA: TEMPLATE LIBRARY (IDEMPOTENTE E AUTOCONTIDO)
-- ==============================================================================

-- NICHO 1: MODA & ACESSÓRIOS
INSERT INTO public.recovery_template_library 
  (niche, niche_label, icon, step_number, step_name, default_delay_minutes, default_coupon_code, is_system_template, default_template_text)
VALUES
  ('moda', 'Moda & Acessórios', 'Shirt', 1, 'Lembrete do Carrinho', 30, '', true, $$Olá {primeiro_nome}! 👗 Seus looks do pedido {numero_pedido} na {nome_loja} ainda estão guardados para você.

Para garantir suas peças antes que esgotem do estoque, finalize pelo link seguro:
👉 {link_pagamento}

Ficou com alguma dúvida sobre tamanhos ou tecido?$$),
  ('moda', 'Moda & Acessórios', 'Shirt', 2, 'Oferta Exclusiva', 240, 'LOOK10', true, $$Oi {primeiro_nome}! Não queremos que você fique sem suas peças! Liberamos o cupom especial *{cupom}* para você concluir seu pedido com desconto agora:
👉 {link_pagamento}

Aproveite, o cupom é válido apenas hoje!$$),
  ('moda', 'Moda & Acessórios', 'Shirt', 3, 'Última Chamada', 1440, '', true, $${primeiro_nome}, hoje é o último dia em que conseguimos reservar as peças do seu pedido {numero_pedido} na {nome_loja}.

Garanta seus produtos com troca grátis clicando aqui:
👉 {link_pagamento}$$)
ON CONFLICT (niche, step_number) DO UPDATE SET
  niche_label = EXCLUDED.niche_label,
  icon = EXCLUDED.icon,
  step_name = EXCLUDED.step_name,
  default_delay_minutes = EXCLUDED.default_delay_minutes,
  default_template_text = EXCLUDED.default_template_text,
  default_coupon_code = EXCLUDED.default_coupon_code,
  is_system_template = EXCLUDED.is_system_template;

-- NICHO 2: BELEZA & COSMÉTICOS
INSERT INTO public.recovery_template_library 
  (niche, niche_label, icon, step_number, step_name, default_delay_minutes, default_coupon_code, is_system_template, default_template_text)
VALUES
  ('cosmeticos', 'Beleza & Cosméticos', 'Sparkles', 1, 'Cuidados Especiais', 30, '', true, $$Olá {primeiro_nome}! ✨ Notamos que você iniciou seu pedido de autocuidado na {nome_loja}.

Para despacharmos seus cosméticos rapidamente, conclua seu pagamento pelo link:
👉 {link_pagamento}

Qualquer dúvida, estamos à disposição!$$),
  ('cosmeticos', 'Beleza & Cosméticos', 'Sparkles', 2, 'Mimo Especial', 240, 'BELEZA10', true, $$Oi {primeiro_nome}! 💄 Que tal um mimo para sua rotina de beleza? Preparamos o cupom *{cupom}* exclusivo para você finalizar seu pedido hoje:
👉 {link_pagamento}$$),
  ('cosmeticos', 'Beleza & Cosméticos', 'Sparkles', 3, 'Reserva Expirando', 1440, '', true, $$Atenção {primeiro_nome}! Seus produtinhos reservados do pedido {numero_pedido} estão voltando para o estoque.

Última chance de garantir o seu kit:
👉 {link_pagamento}$$)
ON CONFLICT (niche, step_number) DO UPDATE SET
  niche_label = EXCLUDED.niche_label,
  icon = EXCLUDED.icon,
  step_name = EXCLUDED.step_name,
  default_delay_minutes = EXCLUDED.default_delay_minutes,
  default_template_text = EXCLUDED.default_template_text,
  default_coupon_code = EXCLUDED.default_coupon_code,
  is_system_template = EXCLUDED.is_system_template;

-- NICHO 3: SUPLEMENTOS & SAÚDE
INSERT INTO public.recovery_template_library 
  (niche, niche_label, icon, step_number, step_name, default_delay_minutes, default_coupon_code, is_system_template, default_template_text)
VALUES
  ('suplementos', 'Suplementos & Fitness', 'Dumbbell', 1, 'Foco no Objetivo', 30, '', true, $$Fala {primeiro_nome}! 💪 Vimos que você iniciou o pedido {numero_pedido} na {nome_loja}.

Não quebre o ritmo dos seus treinos! Conclua o pedido pelo link seguro:
👉 {link_pagamento}$$),
  ('suplementos', 'Suplementos & Fitness', 'Dumbbell', 2, 'Incentivo Extra', 240, 'FORCA10', true, $${primeiro_nome}, foco nos resultados! 🔥 Ativamos o cupom de desconto *{cupom}* para te dar aquela força no pedido {numero_pedido}.

Conclua agora com Pix ou Cartão:
👉 {link_pagamento}$$),
  ('suplementos', 'Suplementos & Fitness', 'Dumbbell', 3, 'Liberação de Lote', 1440, '', true, $${primeiro_nome}, o lote dos seus suplementos precisa ser faturado hoje para mantermos as condições especiais.

Finalize seu pedido aqui:
👉 {link_pagamento}$$)
ON CONFLICT (niche, step_number) DO UPDATE SET
  niche_label = EXCLUDED.niche_label,
  icon = EXCLUDED.icon,
  step_name = EXCLUDED.step_name,
  default_delay_minutes = EXCLUDED.default_delay_minutes,
  default_template_text = EXCLUDED.default_template_text,
  default_coupon_code = EXCLUDED.default_coupon_code,
  is_system_template = EXCLUDED.is_system_template;

-- NICHO 4: ELETRÔNICOS & TECH
INSERT INTO public.recovery_template_library 
  (niche, niche_label, icon, step_number, step_name, default_delay_minutes, default_coupon_code, is_system_template, default_template_text)
VALUES
  ('eletronicos', 'Eletrônicos & Tech', 'Laptop', 1, 'Garantia e Segurança', 30, '', true, $$Olá {primeiro_nome}! ⚡ Seu pedido {numero_pedido} na {nome_loja} foi iniciado com sucesso.

Como nossas unidades têm alta demanda, garanta seu eletrônico pelo link oficial:
👉 {link_pagamento}$$),
  ('eletronicos', 'Eletrônicos & Tech', 'Laptop', 2, 'Condição Exclusiva', 240, 'TECH5', true, $$Oi {primeiro_nome}! Ficou com alguma dúvida técnica sobre os itens do seu pedido? Liberamos o cupom *{cupom}* para facilitar sua compra hoje:
👉 {link_pagamento}$$),
  ('eletronicos', 'Eletrônicos & Tech', 'Laptop', 3, 'Reserva Final', 1440, '', true, $${primeiro_nome}, sua reserva para o pedido {numero_pedido} está chegando ao fim. Para evitar cancelamento do pedido, conclua agora:
👉 {link_pagamento}$$)
ON CONFLICT (niche, step_number) DO UPDATE SET
  niche_label = EXCLUDED.niche_label,
  icon = EXCLUDED.icon,
  step_name = EXCLUDED.step_name,
  default_delay_minutes = EXCLUDED.default_delay_minutes,
  default_template_text = EXCLUDED.default_template_text,
  default_coupon_code = EXCLUDED.default_coupon_code,
  is_system_template = EXCLUDED.is_system_template;

-- NICHO 5: GERAL / E-COMMERCE
INSERT INTO public.recovery_template_library 
  (niche, niche_label, icon, step_number, step_name, default_delay_minutes, default_coupon_code, is_system_template, default_template_text)
VALUES
  ('geral', 'Geral / E-commerce', 'ShoppingBag', 1, 'Lembrete Amigável', 30, '', true, $$Olá {primeiro_nome}! 🛒 Vi que você iniciou o pedido {numero_pedido} na {nome_loja}, mas o pagamento ainda não foi concluído.

Para garantir seus itens com segurança, conclua pelo link oficial:
👉 {link_pagamento}

Qualquer dúvida com Pix ou Cartão, é só responder aqui!$$),
  ('geral', 'Geral / E-commerce', 'ShoppingBag', 2, 'Desconto Especial', 240, 'VOLTA10', true, $$Oi {primeiro_nome}! Separamos uma condição especial para você: use o cupom *{cupom}* e conclua seu pedido com desconto agora mesmo:
👉 {link_pagamento}$$),
  ('geral', 'Geral / E-commerce', 'ShoppingBag', 3, 'Último Aviso', 1440, '', true, $$Aviso importante, {primeiro_nome}! O pedido {numero_pedido} será cancelado automaticamente caso o pagamento não seja identificado.

Acesse o link para concluir:
👉 {link_pagamento}$$)
ON CONFLICT (niche, step_number) DO UPDATE SET
  niche_label = EXCLUDED.niche_label,
  icon = EXCLUDED.icon,
  step_name = EXCLUDED.step_name,
  default_delay_minutes = EXCLUDED.default_delay_minutes,
  default_template_text = EXCLUDED.default_template_text,
  default_coupon_code = EXCLUDED.default_coupon_code,
  is_system_template = EXCLUDED.is_system_template;

