-- Alteração da tabela stores para isolamento de e-mails por loja (multi-tenant)
ALTER TABLE public.stores
ADD COLUMN IF NOT EXISTS resend_from_email TEXT,
ADD COLUMN IF NOT EXISTS resend_api_key TEXT;
