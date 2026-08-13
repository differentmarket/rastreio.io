# Rastreio.IO — Arquitetura SaaS Multi-Tenant & Setup Completo

## 1. Visão Geral da Arquitetura

**App:** Rastreio.IO — Plataforma SaaS Multi-Tenant para Rastreamento Inteligente de Pedidos Shopify, White-Label e Agente de IA de Recuperação de Vendas via WhatsApp.  
**URL de Produção:** https://rastreio-io.vercel.app  
**Stack Tecnológico:** Next.js 16 (App Router + Turbopack), Supabase (PostgreSQL), Vercel Serverless, Evolution API (WhatsApp), OpenAI API (GPT-4o / GPT-4o-mini).  
**Diretório do Projeto:** `c:\Users\Hard Work\Desktop\Tracking`

---

## 2. Infraestrutura e Credenciais

| Serviço | Detalhes |
|---------|----------|
| **Vercel** | Projeto: `rastreio/rastreio-io`, Node 24.x → https://rastreio-io.vercel.app |
| **Supabase DB** | Host: `erxmoerceyieylmgluvf.supabase.co` |
| **Shopify Partners** | Org ID: `227396945` \| App ID: `408583405569` |
| **Shopify Client ID** | `2531fe45558ab25cfda4259051031c07` |
| **Shopify Client Secret** | `<CONFIGURADO_EM_ENV_SHOPIFY_CLIENT_SECRET>` |
| **Partners Token** | `<CONFIGURADO_EM_ENV_SHOPIFY_PARTNERS_TOKEN>` |

---

## 3. Estrutura de Banco de Dados (Supabase Relacional + Multi-Tenant)

### Tabelas Principais:

1. **`stores` (Lojas Integradas no SaaS Multi-Tenant)**:
   - `id` (UUID PK)
   - `nome_loja` TEXT, `shopify_domain` TEXT UNIQUE, `shopify_access_token` TEXT, `shopify_webhook_secret` TEXT
   - **White-Label:** `logo_url`, `primary_color` (default '#4F46E5'), `banner_url`, `banner_link`, `whatsapp_suporte`
   - **Evolution API (WhatsApp):** `evolution_api_url`, `evolution_api_key`, `evolution_instance_name`, `whatsapp_enabled`
   - **Agente de IA LLM:** `ai_recovery_enabled`, `openai_api_key`, `ai_prompt_custom`, `ai_model` (gpt-4o-mini, gpt-4o, gemini-1.5-flash), `ai_tone` (amigavel, vendedor, formal, empatico), `ai_temperature` (numeric 0.1 a 1.0), `ai_coupon_code`

2. **`store_users` (Acessos e Membros por Loja)**:
   - `id` (UUID PK), `store_id` (FK stores), `user_email` TEXT, `role` TEXT DEFAULT 'lojista'

3. **`orders` (Pedidos)**:
   - `id` (UUID PK), `store_id` (FK stores), `shopify_order_id` BIGINT UNIQUE, `customer_id` (FK customers), `numero_pedido`, `status_pedido`, `valor_total`, `itens` (JSONB)

4. **`trackings` (Rastreamentos)**:
   - `id` (UUID PK), `store_id` (FK stores), `order_id` (FK orders), `codigo_rastreio` TEXT UNIQUE, `status`, `historico` (JSONB), `shopify_synced` BOOLEAN

5. **`ai_recovery_conversations` (Histórico de Atendimento e Recuperação com IA)**:
   - `id` (UUID PK), `store_id` (FK stores), `order_id` (FK orders), `customer_phone` TEXT, `customer_name` TEXT, `status` TEXT, `mensagens` (JSONB)

6. **`settings` (Configurações Legadas & Auto-Migrador)**:
   - Tabela de par chave-valor. O sistema possui auto-migração em `GET /api/stores` que converte configurações legadas de `settings` em uma nova loja na tabela `stores` automaticamente.

---

## 4. Módulos e Funcionalidades Principais

### A. Painel Admin Multi-Tenant (`/admin`)
- **Seletor de Lojas em Grid (`!activeStore`)**: Dashboard principal exibindo cards de cada loja integrada, métricas totais e atalho `🚀 Acessar Painel`.
- **Workspace Isolado (`activeStore`)**: Sidebar fixa com abas exclusivas:
  - `📦 Pedidos & Rastreio` (`pedidos`): Tabela e modal com atualização de status, notas de compra e envio de e-mails.
  - `✉️ Fila de E-mails` (`fila`): Fila de disparos com e-mails pendentes e reenviados via Resend.
  - `🤖 Agente de IA` (`ai_agent`): Aba dedicada com parâmetros avançados do LLM (modelo, tom de voz, temperatura, cupom automático, prompt com tags inteligentes e histórico de conversas).
  - `📊 Analytics Logísticos` (`analytics`): Métricas de tempo médio de entrega, entregas concluídas e taxa de sucesso.
  - `⚙️ Configurações Loja` (`settings`): White-Label, Evolution API e dados fiscais da empresa.
  - `👥 Membros da Loja` (`members`): Convite e gerenciamento de acessos por e-mail (`store_users`).

### B. Atendimento e Recuperação de Vendas via WhatsApp (Evolution API + OpenAI)
- **Endpoint de Disparo (`/api/whatsapp/send`)**: Envio automatizado de mensagens via Evolution API.
- **Webhook Autônomo (`/api/webhooks/evolution`)**:
  - Recebe interações dos clientes no WhatsApp.
  - Consulta o pedido e rastreio no Supabase.
  - Substitui variáveis no prompt: `{NOME_CLIENTE}`, `{NUMERO_PEDIDO}`, `{STATUS_RASTREIO}`, `{LINK_RASTREIO}`, `{CUPOM_DESCONTO}`.
  - Executa a chamada ao LLM (OpenAI GPT-4o / GPT-4o-mini) aplicando o **Tom de Voz** e **Temperatura** selecionados.
  - Responde ao comprador no WhatsApp e registra em `ai_recovery_conversations`.

### C. Página Pública de Rastreio White-Label (`/rastreio/[codigo]`)
- Exibe a Logo customizada da loja, tema em cor hexadecimal personalizada (`primary_color`), botão flutuante de suporte via WhatsApp e Banner Promocional de Upsell no rodapé.

---

## 5. Script SQL DDL de Inicialização Completa

Para recriar ou atualizar a estrutura do banco de dados no Supabase, execute o arquivo:
- [supabase/saas_features_schema.sql](file:///c:/Users/Hard%20Work/Desktop/Tracking/supabase/saas_features_schema.sql)

---

## 6. Procedimento de Build e Deploy

**Compilação Local:**
```powershell
npm run build
```

**Deploy de Produção na Vercel:**
```powershell
npx vercel --prod --yes
```
