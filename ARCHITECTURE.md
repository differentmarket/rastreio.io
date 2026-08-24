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

## 🧠 8. Histórico de Decisões, Correções & Evolução de Features

### 8.1 Correção de Inconsistências de Envio e Concorrência (Resend)
- **Descoberta:** Quando disparado o tipo `ambos` (Nota + Rastreio), a execução sequencial síncrona fazia com que se um e-mail falhasse (ex: rate-limit ou timeout), todo o processo era abortado e o segundo e-mail não era enviado.
- **Decisão:** Separou-se os dois fluxos de envio em blocos de exceção `try/catch` independentes no backend, agrupados em execução paralela assíncrona com `Promise.all`. Agora, a falha do envio de um e-mail não impede a entrega do outro, e o backend retorna um diagnóstico detalhado para cada e-mail.

### 8.2 Otimização da UI e Resets de Estados no Admin
- **Problema:** O clique nos botões desabilitava a interface de forma permanente se ocorressem erros não tratados ou após um envio concluído (devido ao estado `sendingEmail` genérico).
- **Decisão:** Foram criados estados granulares e exclusivos de loading/sucesso para cada ação (`sendingNota`/`notaSent`, `sendingRastreio`/`rastreioSent` e `sendingAmbos`/`ambosSent`). Adicionou-se uma rotina de auto-reset com `setTimeout` (3 segundos para sucesso e 4 segundos para erros), garantindo que a UI recupere o controle e fique 100% clicável de forma resiliente.

### 8.3 Fulfillment Automático Shopify
- **Decisão:** A rota de envio individual agora chama `enviarRastreioShopify` integrando os dados de itens de atendimento e o método de entrega selecionado no checkout (lido do payload de dados). Caso o processamento na Shopify seja concluído com sucesso, o status `shopify_synced` é gravado no Supabase.

### 8.4 Visualização Separada de Notificações (Rastreio e Nota)
- **Decisão:** O lojista solicitou poder acompanhar o andamento individual de cada e-mail. Rebatizamos o indicador único na listagem da esquerda e dividimos a coluna de e-mail na Fila em duas: **Rastreio** e **Nota Compra**, com status explícitos `ENVIADO` ou `PENDENTE` renderizados em badges com design moderno.

### 8.5 Reenvio de Rastreio Manual Desbloqueado para Testes
- **Descoberta:** O lojista não conseguia reenviar o rastreio no seu pedido de teste porque a rota individual continha a trava `tracking.email_enviado && !force`.
- **Decisão:** Como a rota `/api/pedidos/[id]/enviar-notificacao` é um endpoint manual e acionado exclusivamente por ação humana no painel admin, removemos a trava de re-envio. O lojista agora pode disparar e testar o envio de rastreio de um mesmo pedido quantas vezes desejar.

### 8.6 Correção do Status de Fulfillment Order da Shopify (unfulfilled vs open)
- **Descoberta:** O processamento automático falhava silenciosamente e os pedidos permaneciam como "Não processado" na Shopify. A resposta da API de ordens de serviço (`fulfillment_orders.json`) retornava ordens de atendimento ativas com status `"open"`. O código original do Rastreio.io buscava apenas por status `"unfulfilled"` ou `"in_progress"`, resultando em falha ao localizar a ordem ativa.
- **Decisão:** Alteramos o filtro de busca em `lib/shopifyService.ts` para verificar por `fo.status === 'open' || fo.status === 'in_progress'`. Isso alinhou a integração à especificação moderna do ciclo de vida de Fulfillment Orders do Shopify REST API e resolveu em definitivo o processamento automático de pedidos.

### 8.7 Popup Modal Reativo para Detalhes do Pedido
- **Solicitação:** Ao rolar a lista de pedidos no painel administrativo e clicar em um item, o painel de detalhes abria fixo na coluna lateral direita, obrigando o lojista a rolar a página de volta até o topo para visualizar as informações.
- **Decisão:** Reestruturamos a aba de pedidos para utilizar a lista em largura cheia (`w-full`) e transformamos o painel de detalhes em um **Popup Modal Flutuante** centralizado com desfoque de fundo (`backdrop-blur-sm`), carregamento reativo (skeleton/spinner controlado por `loadingDetail`), rolagem interna independente, ações de e-mail e botão de fechar.

### 8.8 Disparo de E-mails em Lote Filtrado ("Exceto Hoje")
- **Solicitação:** Opção de disparar e-mails de rastreio e nota em massa para todos os pedidos acumulados na fila, **exceto os pedidos criados no dia atual** (evitando notificar pedidos recém-criados que ainda estão em processamento).
- **Decisão:** Atualizamos o backend em `/api/pedidos/enviar-lote` com suporte ao parâmetro `periodo: 'exceto_hoje'`, filtrando pedidos com `created_at < inicio_do_dia_atual`. Adicionamos os botões **`⏳ Exceto Hoje`** e **`⚡ Disparar (Exceto Pedidos de Hoje)`** no painel de disparos da aba Pedidos e no topo da aba Fila de E-mails.

### 8.9 Correção da URL de Rastreio nos E-mails e Identidade Visual (Rastreio.IO)
- **Descoberta:** Os e-mails enviados omitiam a rota `/rastreio/` no link e utilizavam URLs de preview temporárias da Vercel (`https://rastreio-ri7o2sjad...`), enquanto a aba do navegador exibia o título genérico *"Create Next App"*.
- **Decisão:** Implementamos a sanitização de `appUrl` em todas as rotas (`enviar-lote`, `enviar-notificacao`, `testar-email`, `enviar-rastreio` e `shopifyService`), garantindo o formato canônico `https://rastreio-io.vercel.app/rastreio/[codigo]`. Atualizamos `app/layout.tsx` com o título oficial **"Rastreio.IO — Sistema Inteligente de Rastreamento de Pedidos"** e idioma `pt-BR`.

### 8.10 Harmonização Profissional das Mensagens de Histórico de Logística
- **Descoberta:** O histórico inicial de rastreamento criado na sincronização exibia termos internos para o cliente final, como `"Pedido sincronizado da Shopify e aguardando postagem."` e localização `"Logística Interna"`.
- **Decisão:** Atualizamos a criação de eventos no webhook e sincronizador da Shopify para registrar a mensagem profissional **`"Pedido confirmado e em preparação para envio."`** com localização **`"Centro de Distribuição"`**. Adicionamos a função `sanitizeHistory()` na rota de consulta pública (`/api/rastreio/[codigo]`) para formatar automaticamente registros passados já gravados no Supabase.

### 8.11 Arquitetura SaaS Multi-Tenant (Múltiplas Lojas Integradas)
- **Implementação:** Evoluiu o Rastreio.IO para uma plataforma SaaS onde múltiplos lojistas/Shopifys podem se integrar.
- **Tabela `stores`**: Criada a tabela DDL em `supabase/saas_multi_tenant_schema.sql` para gerenciar lojas integradas (`nome_loja`, `shopify_domain`, `shopify_access_token`, `status`, dados cadastrais).
- **Relacionamentos**: Adicionada a coluna `store_id` nas tabelas `orders` e `trackings`.
- **UI & Gestão Super-Admin**: Adicionada a aba **"Lojas SaaS"** e o menu **Seletor de Loja (Store Switcher)** no topo do painel admin em `app/admin/page.tsx`, com modal **Conectar Nova Loja Shopify** e APIs `/api/stores`.

### 8.12 Isolamento de Taxas e Order Bumps por Loja (Multi-Tenant)
- **Descoberta:** As taxas e order bumps (Bradesco Seguros e Frete Express) eram compartilhados globalmente ou hardcoded. Isso vazava configurações de ofertas e valores de uma loja para outra.
- **Decisão:** Adicionamos colunas específicas de controle de taxas e bumps na tabela `stores`. Adaptamos o Admin para salvar esses campos por loja, e as APIs de consulta e checkout para carregá-los dinamicamente por rastreio, garantindo isolamento total. Mapeamos os order bumps para iniciar com Frete Express marcado e Bradesco desmarcado por padrão no checkout.

### 8.13 Sincronização de Pedidos Pendentes e Recuperação de Vendas via WhatsApp
- **Solicitação:** A sincronização manual da Shopify buscava apenas pedidos pagos, impossibilitando a gestão de recuperação de vendas de pedidos pendentes que não passavam pelo webhook.
- **Decisão:** Alteramos a rota de sincronização `/api/shopify/sync` para puxar status `paid,pending` da Shopify. Implementamos a criação síncrona de conversas de recuperação de vendas na tabela `ai_recovery_conversations` para novos pedidos pendentes vindos da sincronização, além de atualizar o status do agendamento caso um pedido pendente existente seja pago.

---

> **Dica para Economia de Tokens com IAs**: Ao iniciar uma nova instrução com um assistente de IA, mencione apenas: *"Consulte o arquivo `ARCHITECTURE.md` para entender a estrutura e convenções antes de editar."*

