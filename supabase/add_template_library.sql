-- ====================================================
-- Rastreio.IO — Migração FASE 5.3: Biblioteca de Templates & Editor Visual
-- ====================================================

-- 1. Colunas adicionais de controle visual e publicação em recovery_steps
ALTER TABLE public.recovery_steps
ADD COLUMN IF NOT EXISTS step_name TEXT,
ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- 2. Tabela: recovery_template_library
CREATE TABLE IF NOT EXISTS public.recovery_template_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche TEXT NOT NULL, -- 'moda', 'cosmeticos', 'suplementos', 'eletronicos', 'geral'
  niche_label TEXT NOT NULL, -- Rótulo amigável para exibição na UI
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

-- 3. Blindagem de Segurança e RLS
ALTER TABLE public.recovery_template_library ENABLE ROW LEVEL SECURITY;

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

-- 4. Seed Inicial de Templates por Nicho (Totalmente desacoplados do frontend)

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
