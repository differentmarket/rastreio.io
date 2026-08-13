-- ====================================================
-- Rastreio.IO — Migração SaaS Multi-Tenant (Múltiplas Lojas)
-- ====================================================

-- 1. Tabela: stores (Lojas Integradas)
CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_loja TEXT NOT NULL,
  shopify_domain TEXT UNIQUE NOT NULL,
  shopify_access_token TEXT,
  shopify_webhook_secret TEXT,
  status TEXT DEFAULT 'ativa', -- 'ativa', 'pausada', 'cancelada'
  empresa_nome TEXT,
  empresa_cnpj TEXT,
  empresa_endereco TEXT,
  empresa_cidade TEXT,
  empresa_estado TEXT,
  empresa_cep TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stores_domain ON public.stores(shopify_domain);

-- 2. Adicionar coluna store_id em orders (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_orders_store_id ON public.orders(store_id);
  END IF;
END $$;

-- 3. Adicionar coluna store_id em trackings (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trackings' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE public.trackings ADD COLUMN store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_trackings_store_id ON public.trackings(store_id);
  END IF;
END $$;
