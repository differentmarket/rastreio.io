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
   - **Upsell / Recompra:** `upsell_enabled` (boolean), `upsell_title` TEXT, `upsell_description` TEXT, `upsell_coupon` TEXT, `upsell_link` TEXT, `upsell_image_url` TEXT

2. **`store_users` (Acessos e Membros por Loja)**:
   - `id` (UUID PK), `store_id` (FK stores), `user_email` TEXT, `role` TEXT DEFAULT 'lojista'

3. **`orders` (Pedidos)**:
   - `id` (UUID PK), `store_id` (FK stores), `shopify_order_id` BIGINT UNIQUE, `customer_id` (FK customers), `numero_pedido`, `status_pedido`, `valor_total`, `itens` (JSONB)

4. **`trackings` (Rastreamentos)**:
   - `id` (UUID PK), `store_id` (FK stores), `order_id` (FK orders), `codigo_rastreio` TEXT UNIQUE, `status`, `historico` (JSONB), `shopify_synced` BOOLEAN

5. **`ai_recovery_conversations` (Histórico de Atendimento e Recuperação com IA)**:
   - `id` (UUID PK), `store_id` (FK stores), `order_id` (FK orders), `customer_phone` TEXT, `customer_name` TEXT, `status` TEXT, `mensagens` (JSONB)

6. **`tax_payments` (Histórico Financeiro de Taxas & Order Bumps)**:
   - `id` (UUID PK), `store_id` (FK stores), `tracking_id` (FK trackings), `order_id` (FK orders), `transaction_id` TEXT, `valor_taxa_base` DECIMAL, `order_bump_bradesco` BOOLEAN, `valor_bump_bradesco` DECIMAL, `order_bump_express` BOOLEAN, `valor_bump_express` DECIMAL, `valor_total` DECIMAL, `status` ('pendente', 'pago'), `paid_at` TIMESTAMP

7. **`upsell_events` (Metrificação de Conversão de Upsell / Recompra)**:
   - `id` (UUID PK), `store_id` (FK stores), `tracking_id` (FK trackings), `cupom_usado` TEXT, `valor_estimado` DECIMAL, `tipo_evento` ('clique_oferta', 'copiar_cupom'), `created_at` TIMESTAMP

8. **`settings` (Configurações Legadas & Auto-Migrador)**:
   - Tabela de par chave-valor. O sistema possui auto-migração em `GET /api/stores` que converte configurações legadas de `settings` em uma nova loja na tabela `stores` automaticamente.

9. **Regras Críticas de Isolamento Multi-Tenant**:
   - **Isolamento de Ofertas, Taxas e Upsell:** É obrigatório que recursos visuais de checkout/rastreamento e marketing (Taxas, Order Bumps, WhatsApp, Recuperação de Vendas e Banners de Upsell) sejam completamente isolados por loja na tabela `stores`. Nenhuma loja pode carregar ou visualizar ofertas de outra. A tabela global `settings` deve ser lida apenas como fallback para compatibilidade retroativa.

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

## 7. Automações e Regras de Negócio de E-mail / Rastreio

### A. Arquitetura de Sincronização de Pedidos Shopify (Triplo Canal)

1. **Cron Job em Background Otimizado (`/api/cron/sync-shopify`)**:
   - **Mecanismo:** Executa automaticamente em background a cada 5 a 15 minutos (via cron-job.org ou Vercel Cron).
   - **Helper Dedicado (`lib/shopifySyncHelper.ts`)**: Função `executarSincronizacaoShopify(storeIdParam?, onlyRecent=true)` que itera sobre todas as lojas ativas da tabela `stores`.
   - **Otimização Contra Timeout (cron-job.org < 30s):** O parâmetro `onlyRecent=true` restringe a busca da Shopify aos pedidos atualizados nas últimas 72 horas (`updated_at_min=${threeDaysAgoIso}`) e limita a resposta a 1 página (250 itens). Isso reduziu a resposta do cron de >45s para **< 2s**, eliminando o erro *Failed (timeout)* do cron-job.org.
   - **Ordenação Cronológica Crescente (`order=created_at+asc`):** Mantém a ordem do pedido mais antigo para o mais novo. Graças ao filtro `updated_at_min` das últimas 72h, a resposta ignora vendas de meses atrás (#1001) e inicia a importação exatamente no primeiro pedido recente pendente (ex: #1429 em diante até o #1498), salvando 100% dos pedidos de hoje na ordem cronológica correta.

2. **Webhooks Shopify em Tempo Real (`/api/webhooks/shopify`)**:
   - **Mecanismo:** Recebe requisições HTTP POST instantâneas da Shopify nos tópicos `orders/create`, `orders/updated` e `orders/paid`.
   - Valida a assinatura HMAC (`x-shopify-hmac-sha256`) e insere/atualiza o pedido e cliente no Supabase em questão de segundos.

3. **Sincronização Manual via Painel Admin (`/api/shopify/sync`)**:
   - **Mecanismo:** Botão "Sincronizar com Shopify" na aba de Pedidos do Admin, permitindo forçar a busca instantânea pela API REST.

### B. Extração Flexível de Dados do Cliente e Fila de E-mails
- **Resiliência de E-mail e Nome (`app/api/fila-emails` e `app/api/pedidos/enviar-lote`)**:
  - Para evitar que pedidos fiquem travados na fila caso a relação com a tabela `customers` retorne nula, o sistema aplica um fallback extraindo o e-mail e nome diretamente dos dados brutos em `raw_payload` (ex: `raw_payload.customer.email` ou `raw_payload.email`).

### C. Regra de Envio do Comprovante de Compra (Nota Fiscal)
- **Janela de Espera de 2 Horas**:
  - Quando um pedido é pago, o sistema grava o prazo `enviar_nota_em` para 2 horas após a compra.
  - O cron agendado dispara o e-mail do Comprovante de Compra automaticamente assim que a compra completa 2 horas.
  - O intervalo de 2h pode ser configurado em `NOTA_DELAY_HORAS`.
- **Disparo Manual**:
  - O botão de disparo no Admin ignora o delay de 2 horas e envia imediatamente a nota fiscal para os pedidos pendentes elegíveis.

### D. Regra de Envio de Código de Rastreio
- **Disparo no Próximo Dia Útil**:
  - O e-mail de rastreio **não é enviado no mesmo dia da compra**.
  - O rastreio só é enviado se a **Nota Fiscal já tiver sido enviada previamente** (`nota_enviada === true`) e se a data do pedido for anterior ao dia de hoje (`criadoEmDiaAnterior === true`).

---

## 8. Procedimento de Build e Deploy

**Compilação Local:**
```powershell
npm run build
```

**Deploy de Produção na Vercel:**
```powershell
npx vercel --prod --yes
```
