# 🧠 Rastreio.io — Guia de Arquitetura, Cérebro do Projeto & Manual Técnico

> **Finalidade do Documento**: Serve como o "cérebro" unificado do projeto Rastreio.io. Resume a arquitetura, convenções de código, banco de dados, variáveis de ambiente e rotas para otimizar a manutenção do sistema, onboardings e **minimizar consumo de tokens em assistentes IA**.

---

## 🏗️ 1. Visão Geral da Arquitetura

O **Rastreio.io** é uma plataforma SaaS/White-label de rastreamento de encomendas integrada à Shopify, Supabase e Resend, com simulação dinâmica de rastreio e emissão de comprovantes de compra (Nota de Compra).

```
[Cliente Final] ────► [Página Rastreio /rastreio/[codigo]]
                             │
[Lojista / Admin] ──► [Painel Admin /admin]
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 ├────────────── Next.js 16 (App Router) ─────────────────┤
 │  • /api/rastreio/[codigo]       • /api/pedidos         │
 │  • /api/shopify/sync           • /api/settings        │
 │  • /api/cron/sync-shopify      • /api/fila-emails     │
 └──────────────────────────┬─────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
      [Supabase PostgreSQL] [Resend Email] [Shopify Admin REST API]
       (DB, RLS, Auth)      (Notificações) (Sincronização Pedidos)
```

---

## 🛠️ 2. Stack Tecnológica

| Camada | Tecnologia | Descrição / Função |
| :--- | :--- | :--- |
| **Framework Web** | **Next.js 16.2 (App Router)** | SSR, Server Actions, API Routes, Turbopack |
| **Linguagem** | **TypeScript 5.x** | Tipagem estática end-to-end |
| **Estilização** | **Tailwind CSS v4** | UI moderna, dark mode, responsiva |
| **Ícones** | **Lucide React** | Conjunto visual leve e moderno |
| **Banco de Dados** | **Supabase (PostgreSQL 17)** | Banco relacional na nuvem com SSL |
| **Emailing** | **Resend API** | Envio transacional de notificações de rastreio |
| **Integração E-commerce** | **Shopify REST Admin API** | Sincronização automática e envio de fulfillment |
| **Hospedagem / CI/CD** | **Vercel (Hobby / Serverless)** | Deploy contínuo via CLI / GitHub |

---

## 🗄️ 3. Estrutura do Banco de Dados (Supabase Schemas)

### 3.1 Tabela `settings`
Armazena configurações dinâmicas do sistema editáveis via Painel Admin.

```sql
CREATE TABLE public.settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Chaves suportadas**:
- `DELAY_POSTADO_EM_TRANSITO` (dias)
- `DELAY_EM_TRANSITO_SAIU_ENTREGA` (dias)
- `DELAY_SAIU_ENTREGA_ENTREGUE` (dias)
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `NEXT_PUBLIC_APP_URL`
- `EMPRESA_RAZAO_SOCIAL`, `EMPRESA_CNPJ`, `EMPRESA_ENDERECO`, `EMPRESA_CIDADE`, `EMPRESA_ESTADO`, `EMPRESA_CEP`
- `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`

---

### 3.2 Tabela `orders`
Registra os pedidos vindos da Shopify ou criados no admin.

```sql
CREATE TABLE public.orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_order_id TEXT UNIQUE NOT NULL,
  order_number TEXT NOT NULL,
  cliente_nome TEXT NOT NULL,
  cliente_email TEXT NOT NULL,
  cliente_cpf_encrypted TEXT,
  cliente_endereco JSONB,
  produtos JSONB NOT NULL DEFAULT '[]'::jsonb,
  valor_total NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status_pedidos TEXT NOT NULL DEFAULT 'pago',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 3.3 Tabela `trackings`
Armazena o código e histórico de movimentação das encomendas.

```sql
CREATE TABLE public.trackings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  codigo_rastreio TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'postado', -- postado, em_transito, saiu_para_entrega, entregue, extraviado
  historico JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 3.4 Tabela `email_queue`
Fila e log de envios de e-mails de rastreamento aos clientes.

```sql
CREATE TABLE public.email_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  tracking_id UUID REFERENCES public.trackings(id) ON DELETE CASCADE,
  destinatario_email TEXT NOT NULL,
  assunto TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente, enviado, erro
  tentativas INT NOT NULL DEFAULT 0,
  erro_mensagem TEXT,
  proxima_tentativa TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 📁 4. Árvore de Diretórios & Módulos Principais

```
Tracking/
├── app/                        # Next.js App Router
│   ├── admin/                  # Painel de Administração e Gestão
│   │   └── page.tsx            # UI Admin (Gestão Pedidos, Fila, Settings, Recibo/Nota de Compra)
│   ├── api/                    # API Endpoints
│   │   ├── cron/sync-shopify/  # Endpoint para tarefas agendadas (Cron Vercel)
│   │   ├── fila-emails/        # Gestão e reenvio de e-mails em fila
│   │   ├── pedidos/            # Listagem, criação e envio de rastreio de pedidos
│   │   ├── rastreio/[codigo]/  # Consulta pública e atualização de rastreamento
│   │   ├── settings/           # CRUD de configurações dinâmicas
│   │   ├── shopify/sync/       # Trigger manual de sincronização Shopify
│   │   └── webhooks/shopify/   # Receiver de webhooks de novos pedidos Shopify
│   ├── rastreio/[codigo]/      # Página pública visual de rastreio para o cliente final
│   ├── globals.css             # Estilos globais e tokens Tailwind v4
│   ├── layout.tsx              # Layout Raiz
│   └── page.tsx                # Home Page de consulta pública com input de código
├── lib/                        # Utilitários e Serviços do Core
│   ├── authHelper.ts           # Validação JWT do Admin Supabase
│   ├── criptografia.ts         # Encriptação AES-256-CBC para CPF do cliente
│   ├── email.ts                # Envio via Resend API (com busca dinâmica de chaves)
│   ├── gerarCodigoRastreio.ts  # Gerador de códigos únicos (padrão BRYYMMXXXXXX)
│   ├── shopifyService.ts       # Sincronizador REST API Shopify + envio de Fulfillment
│   ├── supabaseAdmin.ts        # Supabase Client com Service Role (Bypass RLS)
│   ├── supabaseClient.ts       # Supabase Client Anon (Front-end)
│   └── verifyShopifyWebhook.ts # Validador HMAC de assinaturas Webhook da Shopify
├── supabase/                   # Schemas e SQLs do banco
│   └── schema.sql              # Schema DDL completo
├── vercel.json                 # Configuração de Crons e Framework da Vercel
└── package.json                # Dependências e scripts
```

---

## ⚡ 5. Fluxos e Regras de Negócio Importantes

### 5.1 Simulação Inteligente de Rastreio (`/api/rastreio/[codigo]`)
- Caso o pedido tenha poucas movimentações manuais, a rota calcula o tempo decorrido desde a compra e insere eventos intermediários diários (ex: *Passagem por Unidade de Tratamento*, *Encaminhado para CDD Local*) para dar a sensação de trânsito contínuo e profissional para o cliente.
- Respeita o horário comercial (entre 08:00 e 17:00) and avança finais de semana para segunda-feira.

### 5.2 Emissão de Nota de Compra (Comprovante Fiscal/Simulado)
- No painel Admin, ao abrir os detalhes de qualquer pedido, há o botão **"Nota de Compra"**.
- Abre uma janela de impressão formatada em layout térmico de 80mm com os dados cadastrados da empresa e dados do cliente/pedido.

### 5.3 Envio de Notificação via Resend
- As configurações `RESEND_API_KEY` e `RESEND_FROM_EMAIL` são lidas prioritariamente do banco de dados (tabela `settings`), permitindo alteração em tempo real pelo painel admin sem necessidade de redeploy.

---

## 🔑 6. Variáveis de Ambiente Requeridas

No `.env.local` e no painel da Vercel:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://erxmoerceyieylmgluvf.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# Criptografia CPF
CPF_ENCRYPTION_KEY=mock-encryption-key-32-chars-long!

# Resend & URL Pública
RESEND_API_KEY=your_resend_api_key_here
RESEND_FROM_EMAIL=Rastreio <noreply@seudominio.com>
NEXT_PUBLIC_APP_URL=https://rastreio-io.vercel.app

# Shopify (Opcional se configurado via Admin)
SHOPIFY_STORE_DOMAIN=sualoja.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxx
SHOPIFY_WEBHOOK_SECRET=xxx
```

---

## 🚀 7. Comandos de Manutenção & Deploy

```bash
# Iniciar ambiente de desenvolvimento
npm run dev

# Testar compilação de produção localmente
npm run build

# Enviar alterações para o GitHub
git add -A
git commit -m "sua alteracao"
git push

# Deploy manual para a Vercel
npx vercel deploy --prod --force
```

---

> **Dica para Economia de Tokens com IAs**: Ao iniciar uma nova instrução com um assistente de IA, mencione apenas: *"Consulte o arquivo `ARCHITECTURE.md` para entender a estrutura e convenções antes de editar."*
