-- Extensão necessária para gen_random_uuid() e criptografia do CPF
create extension if not exists pgcrypto;

-- ============================
-- Tabela: customers
-- ============================
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  shopify_customer_id bigint unique,
  nome text not null,
  cpf_encrypted bytea,              -- CPF criptografado (pgcrypto ou na aplicação)
  cpf_hash text unique,             -- hash (SHA-256) do CPF, usado para busca/dedup sem descriptografar
  email text,
  telefone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_customers_shopify_id on customers(shopify_customer_id);
create index if not exists idx_customers_cpf_hash on customers(cpf_hash);

-- ============================
-- Tabela: addresses
-- ============================
create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  estado text check (char_length(estado) = 2),
  cep text,
  pais text default 'BR',
  created_at timestamptz default now()
);

create index if not exists idx_addresses_customer_id on addresses(customer_id);

-- ============================
-- Tabela: orders
-- ============================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id bigint unique not null,
  customer_id uuid references customers(id),
  address_id uuid references addresses(id),
  numero_pedido text,
  status_pedido text default 'pendente', -- pendente, pago, separacao, enviado, entregue, cancelado
  valor_total numeric(10,2),
  itens jsonb,                       -- snapshot dos itens do pedido
  raw_payload jsonb,                 -- payload bruto do Shopify (auditoria/debug)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_orders_shopify_id on orders(shopify_order_id);
create index if not exists idx_orders_customer_id on orders(customer_id);

-- ============================
-- Tabela: trackings
-- ============================
create table if not exists trackings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) unique not null,
  codigo_rastreio text unique not null,
  status text default 'postado',     -- postado, em_transito, saiu_para_entrega, entregue, extraviado
  historico jsonb default '[]'::jsonb, -- array de eventos: [{status, data, descricao, local}]
  shopify_synced boolean default false, -- flag para controle de envio atrasado
  sync_after timestamptz,            -- data a partir da qual o rastreio pode ser enviado
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_trackings_codigo on trackings(codigo_rastreio);

-- ============================
-- Trigger: updated_at automático
-- ============================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Remove triggers se já existirem antes de criar
drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at before update on customers
  for each row execute function set_updated_at();

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at before update on orders
  for each row execute function set_updated_at();

drop trigger if exists trg_trackings_updated_at on trackings;
create trigger trg_trackings_updated_at before update on trackings
  for each row execute function set_updated_at();

-- ============================
-- Row Level Security (RLS)
-- ============================
alter table customers enable row level security;
alter table addresses enable row level security;
alter table orders enable row level security;
alter table trackings enable row level security;

-- Como as chaves service_role serão usadas no backend, bloqueamos acesso público direto de escrita.
-- Mas vamos criar policies de leitura e escrita restritas.
-- Para `trackings`, podemos permitir leitura pública caso queira fazer fetch direto do client via anon key,
-- ou opcionalmente desabilitar e forçar a passar por rota de API. 
-- Criamos a policy de leitura pública para trackings de qualquer forma:
drop policy if exists "Permitir leitura pública de rastreios" on trackings;
create policy "Permitir leitura pública de rastreios" on trackings
  for select using (true);

-- ============================
-- Tabela: settings (para credenciais dinâmicas do Shopify)
-- ============================
create table if not exists settings (
  key text primary key,
  value text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table settings enable row level security;

-- Trigger para updated_at na tabela settings
drop trigger if exists trg_settings_updated_at on settings;
create trigger trg_settings_updated_at before update on settings
  for each row execute function set_updated_at();

-- ============================
-- Comandos de Atualização (Migrations de Alter Table)
-- ============================
-- Caso o banco já tenha sido gerado, execute apenas as linhas abaixo no SQL Editor do Supabase:
-- alter table trackings add column if not exists shopify_synced boolean default false;
-- alter table trackings add column if not exists sync_after timestamptz;
