-- ====================================================
-- Rastreio.IO — Migração SaaS Multi-Tenant Users & Roles
-- ====================================================

-- 1. Tabela: store_users (Vínculo entre Usuários do Auth e Lojas)
CREATE TABLE IF NOT EXISTS public.store_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'owner', -- 'superadmin', 'owner', 'member'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_store_users_user_id ON public.store_users(user_id);
CREATE INDEX IF NOT EXISTS idx_store_users_store_id ON public.store_users(store_id);
