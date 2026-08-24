-- Alteração da tabela stores para incluir colunas de Upsell e Recompra por loja (multi-tenant)
ALTER TABLE public.stores
ADD COLUMN IF NOT EXISTS upsell_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS upsell_title TEXT DEFAULT 'Ganhe 15% OFF na sua próxima compra!',
ADD COLUMN IF NOT EXISTS upsell_description TEXT DEFAULT 'Aproveite nossa condição exclusiva de frete grátis e desconto para clientes.',
ADD COLUMN IF NOT EXISTS upsell_coupon TEXT DEFAULT 'CLIENTE15',
ADD COLUMN IF NOT EXISTS upsell_link TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS upsell_image_url TEXT DEFAULT '';
