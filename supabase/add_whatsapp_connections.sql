-- ==============================================================================
-- Rastreio.IO — Conexões WhatsApp Multi-Provider (Evolution, WAHA, Meta Cloud)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('evolution', 'waha', 'meta_cloud')),
  instance_name TEXT NOT NULL, -- Evolution: instance_name | WAHA: session | Meta: phone_number_id
  api_url TEXT NOT NULL,
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb, -- Armazena { api_key, token, etc. } de forma extensível
  priority INTEGER NOT NULL DEFAULT 1, -- Ordem de prioridade / fallback entre conexões da mesma loja
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'connecting', 'disconnected')),
  is_default BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, provider, instance_name)
);

-- Índices de consulta de alta performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_conn_lookup 
  ON public.whatsapp_connections(provider, instance_name) 
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_whatsapp_conn_store_priority 
  ON public.whatsapp_connections(store_id, priority ASC, is_default DESC) 
  WHERE status = 'active';

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

-- 1. Permissão total para service_role (Webhooks e workers backend)
DROP POLICY IF EXISTS "Service role full access on whatsapp_connections" ON public.whatsapp_connections;
CREATE POLICY "Service role full access on whatsapp_connections"
  ON public.whatsapp_connections FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Permissão de leitura para usuários autenticados da loja
DROP POLICY IF EXISTS "Users can view whatsapp_connections for their stores" ON public.whatsapp_connections;
CREATE POLICY "Users can view whatsapp_connections for their stores"
  ON public.whatsapp_connections FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

-- 3. Permissão de edição/gerenciamento apenas para owners
DROP POLICY IF EXISTS "Owners can manage whatsapp_connections for their stores" ON public.whatsapp_connections;
CREATE POLICY "Owners can manage whatsapp_connections for their stores"
  ON public.whatsapp_connections FOR ALL
  TO authenticated
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'owner'
    )
  )
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'owner'
    )
  );
