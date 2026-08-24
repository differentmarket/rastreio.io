-- Alteração da tabela stores para incluir colunas de taxas e order bumps por loja (multi-tenant)
ALTER TABLE public.stores
ADD COLUMN IF NOT EXISTS taxa_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS taxa_nome TEXT DEFAULT 'Taxa de Despacho Postal e Liberação Alfandegária',
ADD COLUMN IF NOT EXISTS taxa_valor NUMERIC(10,2) DEFAULT 27.90,
ADD COLUMN IF NOT EXISTS taxa_link_pagamento TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS taxa_dias_tentativas TEXT DEFAULT '9,10,11',
ADD COLUMN IF NOT EXISTS taxa_dia_exibicao INT DEFAULT 11,
ADD COLUMN IF NOT EXISTS order_bump_bradesco_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS order_bump_bradesco_valor NUMERIC(10,2) DEFAULT 14.76,
ADD COLUMN IF NOT EXISTS order_bump_express_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS order_bump_express_valor NUMERIC(10,2) DEFAULT 9.91;
