-- Tabela de Histórico Financeiro e Metrificação de Taxas e Order Bumps por Loja
CREATE TABLE IF NOT EXISTS public.tax_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
    tracking_id UUID REFERENCES public.trackings(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    transaction_id TEXT,
    valor_taxa_base DECIMAL(10, 2) DEFAULT 27.90,
    order_bump_bradesco BOOLEAN DEFAULT false,
    valor_bump_bradesco DECIMAL(10, 2) DEFAULT 0.00,
    order_bump_express BOOLEAN DEFAULT false,
    valor_bump_express DECIMAL(10, 2) DEFAULT 0.00,
    valor_total DECIMAL(10, 2) NOT NULL,
    status TEXT DEFAULT 'pendente', -- 'pendente', 'pago', 'cancelado'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    paid_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_tax_payments_store_id ON public.tax_payments(store_id);
CREATE INDEX IF NOT EXISTS idx_tax_payments_tracking_id ON public.tax_payments(tracking_id);
CREATE INDEX IF NOT EXISTS idx_tax_payments_status ON public.tax_payments(status);

-- Tabela de Metrificação de Cliques e Vendas de Upsell (Recompra no Rastreio)
CREATE TABLE IF NOT EXISTS public.upsell_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
    tracking_id UUID REFERENCES public.trackings(id) ON DELETE SET NULL,
    cupom_usado TEXT,
    valor_estimado DECIMAL(10, 2) DEFAULT 0.00,
    tipo_evento TEXT DEFAULT 'clique', -- 'clique', 'conversao'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_upsell_events_store_id ON public.upsell_events(store_id);
CREATE INDEX IF NOT EXISTS idx_upsell_events_tracking_id ON public.upsell_events(tracking_id);
