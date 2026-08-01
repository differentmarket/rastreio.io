import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Helper to load env files
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      process.env[key] = value.trim();
    }
  });
}

loadEnv(path.resolve('.env.local'));
loadEnv(path.resolve('.env'));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN || '';
const shopifyToken = process.env.SHOPIFY_ADMIN_TOKEN || '';

// Parse argument flags (e.g., node scripts/test-shopify-sync.mjs --order 123456789)
const args = process.argv.slice(2);
const orderArgIndex = args.indexOf('--order');
const customOrderId = orderArgIndex !== -1 ? args[orderArgIndex + 1] : null;
const trackingArgIndex = args.indexOf('--tracking');
const customTrackingCode = trackingArgIndex !== -1 ? args[trackingArgIndex + 1] : null;

console.log('=== TESTE DE ENVIO DE RASTREIO PARA SHOPIFY ===');
console.log(`Supabase URL: ${supabaseUrl}`);
console.log(`Shopify Domain: ${shopifyDomain || 'Não configurado'}`);
console.log(`Shopify Token: ${shopifyToken ? 'Configurado' : 'Não configurado'}`);

if (customOrderId) {
  console.log(`Usando ID de Pedido Shopify customizado: ${customOrderId}`);
}
if (customTrackingCode) {
  console.log(`Usando Código de Rastreio customizado: ${customTrackingCode}`);
}

if (!supabaseUrl || !serviceRoleKey || supabaseUrl.includes('mock-project')) {
  console.log('\n[AVISO] Supabase real não configurado no .env.local.');
  console.log('Executando simulação offline das funções...');
  executarSimulacaoOffline();
} else {
  executarTesteIntegrado();
}

// ----------------------------------------------------
// Funções auxiliares de criptografia idênticas à app
// ----------------------------------------------------
function getEncryptionKey() {
  const key = process.env.CPF_ENCRYPTION_KEY || 'mock-encryption-key-32-chars-long!';
  return crypto.createHash('sha256').update(key).digest();
}

function criptografar(texto) {
  if (!texto) return Buffer.alloc(0);
  const iv = crypto.randomBytes(16);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

function gerarCpfHash(cpf) {
  if (!cpf) return '';
  const cpfLimpo = cpf.replace(/\D/g, '');
  return crypto.createHash('sha256').update(cpfLimpo).digest('hex');
}

// ----------------------------------------------------
// Simulação de Envio
// ----------------------------------------------------
async function enviarRastreioShopifyMock(shopifyOrderId, codigoRastreio) {
  if (!shopifyDomain || !shopifyToken || shopifyDomain.includes('mock-store')) {
    console.log(`\n[Shopify Mock] Sincronizado código ${codigoRastreio} para o pedido Shopify ${shopifyOrderId}`);
    return true;
  }

  try {
    const cleanDomain = shopifyDomain.replace(/^https?:\/\//, '');
    const fulfillmentOrdersUrl = `https://${cleanDomain}/admin/api/2024-10/orders/${shopifyOrderId}/fulfillment_orders.json`;

    console.log(`[Shopify API] Buscando fulfillment orders para o pedido ${shopifyOrderId}...`);
    const resFo = await fetch(fulfillmentOrdersUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': shopifyToken,
        'Content-Type': 'application/json',
      },
    });

    if (!resFo.ok) {
      const errText = await resFo.text();
      console.error(`[Shopify API] Erro ao obter fulfillment orders:`, errText);
      return false;
    }

    const foData = await resFo.json();
    const fulfillmentOrders = foData.fulfillment_orders || [];
    const activeFo = fulfillmentOrders.find(
      (fo) => fo.status === 'unfulfilled' || fo.status === 'in_progress'
    );

    if (!activeFo) {
      console.warn(`[Shopify API] Nenhum fulfillment_order ativo para o pedido ${shopifyOrderId}. Talvez já atendido.`);
      return false;
    }

    console.log(`[Shopify API] Fulfillment Order ativo encontrado (ID: ${activeFo.id}).`);
    const trackingUrl = `https://rastreio-app.vercel.app/rastreio/${codigoRastreio}`;

    const fulfillmentUrl = `https://${cleanDomain}/admin/api/2024-10/fulfillments.json`;
    const payload = {
      fulfillment: {
        message: 'Código de rastreamento próprio gerado.',
        notify_customer: true,
        tracking_info: {
          number: codigoRastreio,
          url: trackingUrl,
          company: 'Rastreio Próprio',
        },
        line_items_by_fulfillment_order: [
          {
            fulfillment_order_id: activeFo.id,
            fulfillment_order_line_items: [],
          },
        ],
      },
    };

    console.log(`[Shopify API] Criando fulfillment e notificando cliente...`);
    const resFulfillment = await fetch(fulfillmentUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shopifyToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resFulfillment.ok) {
      const errText = await resFulfillment.text();
      console.error(`[Shopify API] Erro ao criar fulfillment:`, errText);
      return false;
    }

    console.log(`[Shopify API] Sucesso ao enviar rastreio ${codigoRastreio} para o pedido Shopify ${shopifyOrderId}`);
    return true;
  } catch (error) {
    console.error(`[Shopify API] Falha técnica na integração:`, error);
    return false;
  }
}

// 1. Simulação Offline
function executarSimulacaoOffline() {
  console.log('\n--- SIMULAÇÃO OFFLINE ---');
  const shopifyOrderId = customOrderId ? Number(customOrderId) : 1234567890;
  const codigoRastreio = customTrackingCode || ('RST' + Math.random().toString().substring(2, 11).toUpperCase());
  
  console.log(`1. Simulando recebimento de pedido Shopify #${shopifyOrderId}`);
  console.log('2. Dados do cliente criptografados...');
  const cpf = '123.456.789-00';
  const cpfEnc = criptografar(cpf).toString('hex');
  const cpfHash = gerarCpfHash(cpf);
  console.log(`   - CPF Hash: ${cpfHash}`);
  console.log(`   - CPF Criptografado (hex): ${cpfEnc}`);
  
  console.log(`3. Gerando código de rastreamento temporário: ${codigoRastreio}`);
  
  console.log('4. Enviando rastreio de volta para a Shopify...');
  enviarRastreioShopifyMock(shopifyOrderId, codigoRastreio).then(sucesso => {
    console.log(`\nResultado do Envio: ${sucesso ? '✓ SUCESSO (Mock)' : '✗ FALHA'}`);
  });
}

// 2. Teste Real Integrado no Banco de Dados
async function executarTesteIntegrado() {
  console.log('\n--- INICIANDO TESTE INTEGRADO NO SUPABASE ---');
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const shopifyOrderId = customOrderId ? Number(customOrderId) : Math.floor(Math.random() * 10000000000);
  const orderNumber = String(Math.floor(Math.random() * 9000) + 1000);
  const codigoRastreio = customTrackingCode || ('RST' + Math.random().toString().substring(2, 11).toUpperCase());

  try {
    // A. Criar Cliente de Teste
    const cpf = '999.999.999-99';
    const cpfHash = gerarCpfHash(cpf);
    const cpfEnc = criptografar(cpf);

    console.log('1. Inserindo cliente de teste...');
    const { data: customer, error: cErr } = await supabaseAdmin
      .from('customers')
      .insert({
        shopify_customer_id: Math.floor(Math.random() * 10000000),
        nome: 'Cliente Teste Shopify',
        email: 'teste@exemplo.com',
        telefone: '+5511999999999',
        cpf_encrypted: `\\x${cpfEnc.toString('hex')}`,
        cpf_hash: cpfHash
      })
      .select('id')
      .single();

    if (cErr) throw cErr;
    console.log(`   - Cliente criado com ID: ${customer.id}`);

    // B. Criar Pedido de Teste
    console.log('2. Inserindo pedido de teste...');
    const { data: order, error: oErr } = await supabaseAdmin
      .from('orders')
      .insert({
        shopify_order_id: shopifyOrderId,
        customer_id: customer.id,
        numero_pedido: orderNumber,
        status_pedido: 'pago',
        valor_total: 150.00,
        itens: [{ title: 'Item Teste', quantity: 1, price: '150.00' }]
      })
      .select('id')
      .single();

    if (oErr) throw oErr;
    console.log(`   - Pedido criado com ID: ${order.id} (Shopify Order ID: ${shopifyOrderId})`);

    // C. Criar Rastreio pendente de sincronização (sync_after no passado para rodar na hora)
    console.log('3. Inserindo rastreamento pendente...');
    const syncAfter = new Date(Date.now() - 3600000).toISOString(); // 1 hora atrás
    const { error: tErr } = await supabaseAdmin
      .from('trackings')
      .insert({
        order_id: order.id,
        codigo_rastreio: codigoRastreio,
        shopify_synced: false,
        sync_after: syncAfter,
        status: 'postado',
        historico: [
          {
            status: 'postado',
            data: new Date().toISOString(),
            descricao: 'Pedido recebido no sistema e aguardando postagem.',
            local: 'Logística Interna',
          }
        ]
      });

    if (tErr) throw tErr;
    console.log(`   - Rastreamento criado: ${codigoRastreio} (sync_after: ${syncAfter})`);

    // D. Executar a sincronização
    console.log('4. Executando envio do rastreio para o Shopify...');
    const sucesso = await enviarRastreioShopifyMock(shopifyOrderId, codigoRastreio);

    if (sucesso) {
      console.log('5. Atualizando flag shopify_synced no banco...');
      const { error: updErr } = await supabaseAdmin
        .from('trackings')
        .update({ shopify_synced: true })
        .eq('codigo_rastreio', codigoRastreio);

      if (updErr) {
        console.error('   - Erro ao atualizar status de sincronização:', updErr);
      } else {
        console.log('   - Flag shopify_synced marcada como TRUE com sucesso!');
      }
    }

    console.log('\n✓ Teste concluído com sucesso!');
  } catch (error) {
    console.error('\n✗ Erro durante a execução do teste integrado:', error);
  }
}
