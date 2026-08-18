-- ════════════════════════════════════════════════════════════
-- RASTREIO.IO - COMPLETO: TABELA STORES, WHITE-LABEL, WHATSAPP & IA
-- ════════════════════════════════════════════════════════════

-- 1. Criar Tabela 'stores' (caso ainda não exista no Supabase)
CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_loja TEXT NOT NULL,
  shopify_domain TEXT UNIQUE NOT NULL,
  shopify_access_token TEXT,
  shopify_webhook_secret TEXT,
  status TEXT DEFAULT 'ativa',
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

-- 2. Garantir colunas de White-Label, Evolution API e Agente de IA na tabela 'stores'
ALTER TABLE public.stores
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#4F46E5',
ADD COLUMN IF NOT EXISTS banner_url TEXT,
ADD COLUMN IF NOT EXISTS banner_link TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_suporte TEXT,
ADD COLUMN IF NOT EXISTS evolution_api_url TEXT,
ADD COLUMN IF NOT EXISTS evolution_api_key TEXT,
ADD COLUMN IF NOT EXISTS evolution_instance_name TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ai_recovery_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS openai_api_key TEXT,
ADD COLUMN IF NOT EXISTS ai_prompt_custom TEXT,
ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'gpt-4o-mini',
ADD COLUMN IF NOT EXISTS ai_tone TEXT DEFAULT 'amigavel',
ADD COLUMN IF NOT EXISTS ai_temperature NUMERIC DEFAULT 0.7,
ADD COLUMN IF NOT EXISTS ai_coupon_code TEXT,
ADD COLUMN IF NOT EXISTS ai_delay_days INT DEFAULT 1;

-- 3. Vincular store_id em 'orders' e 'trackings' se existirem
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'store_id') THEN
      ALTER TABLE public.orders ADD COLUMN store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_orders_store_id ON public.orders(store_id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trackings') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trackings' AND column_name = 'store_id') THEN
      ALTER TABLE public.trackings ADD COLUMN store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_trackings_store_id ON public.trackings(store_id);
    END IF;
  END IF;
END $$;

-- 4. Tabela de Usuários por Loja (Multi-Tenant)
CREATE TABLE IF NOT EXISTS public.store_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  user_id UUID, -- ID do usuário do Supabase Auth
  role TEXT DEFAULT 'owner', -- 'owner', 'member', 'lojista'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, user_email),
  UNIQUE(store_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_store_users_user_id ON public.store_users(user_id);
CREATE INDEX IF NOT EXISTS idx_store_users_store_id ON public.store_users(store_id);

-- 5. Tabela para Histórico de Conversas e Recuperações de Vendas do Agente de IA
CREATE TABLE IF NOT EXISTS public.ai_recovery_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT,
    status TEXT DEFAULT 'em_andamento',
    mensagens JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_recovery_store_id ON public.ai_recovery_conversations(store_id);
CREATE INDEX IF NOT EXISTS idx_ai_recovery_phone ON public.ai_recovery_conversations(customer_phone);
