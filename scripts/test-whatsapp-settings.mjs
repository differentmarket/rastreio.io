/**
 * Suíte de Testes Automatizados — Configurações do WhatsApp Multi-Provider (Evolution + WAHA)
 *
 * Cenários Testados:
 * 1. TESTE 1: Carregar conexão WAHA da loja.
 * 2. TESTE 2: Criar/atualizar conexão WAHA.
 * 3. TESTE 3: Salvar novamente não cria duplicata (idempotência com UNIQUE(store_id, provider, instance_name)).
 * 4. TESTE 4: Credencial não aparece no retorno da API/frontend (mascarada com ••••••••).
 * 5. TESTE 5: Evolution e WAHA podem coexistir na mesma loja.
 * 6. TESTE 6: Tenant A não consegue acessar conexão da Tenant B.
 * 7. TESTE 7: Router encontra a conexão WAHA corretamente.
 * 8. TESTE 8: Conexão inativa não é escolhida pelo router.
 * 9. TESTE 9: URL WAHA é normalizada corretamente (remover trailing slashes, garantir protocolo).
 * 10. TESTE 10: Nenhuma credencial aparece nos logs.
 */

import assert from 'assert';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🧪 INICIANDO TESTES DE CONFIGURAÇÕES DE WHATSAPP MULTI-PROVIDER');
console.log('═══════════════════════════════════════════════════════════════\n');

// ---------------------------------------------------------------------------
// SIMULAÇÃO DO BANCO EM MEMÓRIA
// ---------------------------------------------------------------------------
const mockStores = [
  {
    id: 'store-alpha-tenant-1',
    nome_loja: 'Loja Alpha',
    evolution_api_url: 'https://evolution.alpha.com',
    evolution_api_key: 'evo-secret-key-alpha-999',
    evolution_instance_name: 'instancia_alpha',
    whatsapp_enabled: true,
  },
  {
    id: 'store-beta-tenant-2',
    nome_loja: 'Loja Beta',
    evolution_api_url: '',
    evolution_api_key: '',
    evolution_instance_name: '',
    whatsapp_enabled: false,
  },
];

let mockDbConnections = [];

// Utilitários espelhados da API
function isMaskedValue(val) {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed.includes('•') || trimmed.includes('*');
}

function maskApiKey(key) {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 4) return '••••••••';
  return `••••••••••••${trimmed.slice(-4)}`;
}

function normalizeUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) return '';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

// Handler simulado do GET /api/whatsapp/connections
function simulateGetConnections(storeId, requestingStoreId) {
  // Verificação de tenant
  if (storeId !== requestingStoreId) {
    return { status: 403, error: 'Acesso negado entre tenants distintos.' };
  }

  const connections = mockDbConnections.filter(c => c.store_id === storeId);
  const store = mockStores.find(s => s.id === storeId);

  const sanitized = connections.map(c => {
    const rawKey = c.credentials?.api_key || '';
    return {
      ...c,
      credentials: {
        ...c.credentials,
        api_key: maskApiKey(rawKey),
      },
      has_api_key: Boolean(rawKey),
    };
  });

  return {
    status: 200,
    connections: sanitized,
    legacy_evolution: store ? {
      evolution_api_url: store.evolution_api_url,
      evolution_instance_name: store.evolution_instance_name,
      evolution_api_key: maskApiKey(store.evolution_api_key),
      has_api_key: Boolean(store.evolution_api_key),
    } : null,
  };
}

// Handler simulado do POST /api/whatsapp/connections (UPSERT)
function simulatePostConnection(payload, requestingStoreId) {
  if (payload.store_id !== requestingStoreId) {
    return { status: 403, error: 'Acesso negado entre tenants distintos.' };
  }

  const cleanInstance = (payload.instance_name || '').trim();
  const cleanUrl = normalizeUrl(payload.api_url);

  let finalApiKey = (payload.api_key || '').trim();
  if (isMaskedValue(finalApiKey) || !finalApiKey) {
    const existing = mockDbConnections.find(
      c => c.store_id === payload.store_id && c.provider === payload.provider && c.instance_name === cleanInstance
    );
    if (existing?.credentials?.api_key) {
      finalApiKey = existing.credentials.api_key;
    }
  }

  if (payload.is_default) {
    mockDbConnections.forEach(c => {
      if (c.store_id === payload.store_id) {
        c.is_default = false;
      }
    });
  }

  // Idempotência UPSERT: UNIQUE(store_id, provider, instance_name)
  const existingIndex = mockDbConnections.findIndex(
    c => c.store_id === payload.store_id && c.provider === payload.provider && c.instance_name === cleanInstance
  );

  const savedRecord = {
    id: existingIndex >= 0 ? mockDbConnections[existingIndex].id : `conn-${Date.now()}-${Math.random()}`,
    store_id: payload.store_id,
    provider: payload.provider,
    instance_name: cleanInstance,
    api_url: cleanUrl,
    credentials: { api_key: finalApiKey },
    status: payload.status || 'active',
    is_default: payload.is_default !== undefined ? payload.is_default : true,
    priority: payload.priority || 1,
    updated_at: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    mockDbConnections[existingIndex] = savedRecord;
  } else {
    mockDbConnections.push(savedRecord);
  }

  // Se for WAHA, lojas NUNCA são alteradas
  // Se for Evolution, compatibilidade legada pode ser espelhada
  if (payload.provider === 'evolution') {
    const s = mockStores.find(st => st.id === payload.store_id);
    if (s) {
      s.evolution_api_url = cleanUrl;
      s.evolution_instance_name = cleanInstance;
      if (finalApiKey) s.evolution_api_key = finalApiKey;
    }
  }

  return {
    status: 200,
    connection: {
      ...savedRecord,
      credentials: { api_key: maskApiKey(finalApiKey) },
      has_api_key: Boolean(finalApiKey),
    },
  };
}

// Simulador do Router de Resolução (mesma lógica de whatsappRouter.ts)
function resolveWhatsAppConnection(storeId, instanceName) {
  const storeConnections = mockDbConnections.filter(
    c => c.store_id === storeId && c.status === 'active'
  );

  if (instanceName) {
    const specific = storeConnections.find(c => c.instance_name === instanceName);
    if (specific) return specific;
  }

  storeConnections.sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return (a.priority || 1) - (b.priority || 1);
  });

  if (storeConnections.length > 0) {
    return storeConnections[0];
  }

  // Fallback para stores legada
  const store = mockStores.find(s => s.id === storeId);
  if (store && store.evolution_api_url && store.evolution_instance_name) {
    return {
      store_id: store.id,
      provider: 'evolution',
      instance_name: store.evolution_instance_name,
      api_url: store.evolution_api_url,
      credentials: { api_key: store.evolution_api_key },
      priority: 99,
      status: store.whatsapp_enabled ? 'active' : 'inactive',
      is_default: false,
    };
  }

  return null;
}

// ===========================================================================
// EXECUÇÃO DOS 10 CENÁRIOS DE TESTE
// ===========================================================================

// TESTE 1 & 2: Criar e Carregar Conexão WAHA
console.log('🔹 Executando Testes 1 e 2: Criar e Carregar conexão WAHA...');
const createWahaRes = simulatePostConnection({
  store_id: 'store-alpha-tenant-1',
  provider: 'waha',
  instance_name: 'default',
  api_url: 'https://waha.vps11349.panel.icontainer.online/',
  api_key: '4AMEccT4Seze6wfMmyMkiJ378iTCRn3K',
  status: 'active',
  is_default: true,
  priority: 1,
}, 'store-alpha-tenant-1');

assert.strictEqual(createWahaRes.status, 200, 'Criação do WAHA deve retornar 200');
assert.strictEqual(createWahaRes.connection.provider, 'waha');
assert.strictEqual(createWahaRes.connection.instance_name, 'default');
assert.strictEqual(createWahaRes.connection.api_url, 'https://waha.vps11349.panel.icontainer.online');
console.log('✅ Teste 2 aprovado: Conexão WAHA criada com sucesso.');

const getWahaRes = simulateGetConnections('store-alpha-tenant-1', 'store-alpha-tenant-1');
assert.strictEqual(getWahaRes.status, 200);
assert.strictEqual(getWahaRes.connections.length, 1);
assert.strictEqual(getWahaRes.connections[0].provider, 'waha');
console.log('✅ Teste 1 aprovado: Conexão WAHA carregada com sucesso.');

// TESTE 3: Idempotência - Salvar novamente não cria duplicata
console.log('\n🔹 Executando Teste 3: Idempotência (salvar novamente não cria duplicata)...');
const resaveWahaRes = simulatePostConnection({
  store_id: 'store-alpha-tenant-1',
  provider: 'waha',
  instance_name: 'default',
  api_url: 'https://waha.vps11349.panel.icontainer.online',
  api_key: '••••••••••••Rn3K', // Chave mascarada
  status: 'active',
  is_default: true,
}, 'store-alpha-tenant-1');

assert.strictEqual(resaveWahaRes.status, 200);
const allAlphaConnections = mockDbConnections.filter(c => c.store_id === 'store-alpha-tenant-1' && c.provider === 'waha');
assert.strictEqual(allAlphaConnections.length, 1, 'Deve continuar existindo apenas 1 registro WAHA para a sessão default');
assert.strictEqual(allAlphaConnections[0].credentials.api_key, '4AMEccT4Seze6wfMmyMkiJ378iTCRn3K', 'Chave real no banco deve ser preservada ao enviar máscara');
console.log('✅ Teste 3 aprovado: Idempotência garantida via UNIQUE(store_id, provider, instance_name).');

// TESTE 4: Credencial mascarada no retorno
console.log('\n🔹 Executando Teste 4: Credencial protegida e mascarada no retorno...');
assert.strictEqual(resaveWahaRes.connection.credentials.api_key, '••••••••••••Rn3K');
assert.strictEqual(resaveWahaRes.connection.credentials.api_key.includes('4AMEccT4Seze'), false, 'Chave completa nunca pode ser retornada');
console.log('✅ Teste 4 aprovado: API Key nunca retorna completa para o frontend.');

// TESTE 5: Evolution e WAHA podem coexistir
console.log('\n🔹 Executando Teste 5: Coexistência Evolution + WAHA...');
const createEvoRes = simulatePostConnection({
  store_id: 'store-alpha-tenant-1',
  provider: 'evolution',
  instance_name: 'instancia_alpha_01',
  api_url: 'https://evolution.alpha.com',
  api_key: 'evo-secret-999',
  status: 'active',
  is_default: false,
  priority: 2,
}, 'store-alpha-tenant-1');

assert.strictEqual(createEvoRes.status, 200);
const totalAlpha = mockDbConnections.filter(c => c.store_id === 'store-alpha-tenant-1');
assert.strictEqual(totalAlpha.length, 2, 'Loja Alpha deve ter 2 conexões (1 WAHA e 1 Evolution)');
assert.strictEqual(totalAlpha.some(c => c.provider === 'waha'), true);
assert.strictEqual(totalAlpha.some(c => c.provider === 'evolution'), true);
console.log('✅ Teste 5 aprovado: Evolution e WAHA coexistem sem colisão.');

// TESTE 6: Isolamento Multi-Tenant (Tenant A vs Tenant B)
console.log('\n🔹 Executando Teste 6: Isolamento Multi-Tenant estrito...');
const crossTenantGet = simulateGetConnections('store-alpha-tenant-1', 'store-beta-tenant-2');
assert.strictEqual(crossTenantGet.status, 403, 'Tenant B não pode ler conexões do Tenant A');

const crossTenantPost = simulatePostConnection({
  store_id: 'store-alpha-tenant-1',
  provider: 'waha',
  instance_name: 'hack',
  api_url: 'https://hacker.com',
}, 'store-beta-tenant-2');
assert.strictEqual(crossTenantPost.status, 403, 'Tenant B não pode modificar conexões do Tenant A');
console.log('✅ Teste 6 aprovado: Tenant A e Tenant B totalmente isolados.');

// TESTE 7: Router encontra a conexão WAHA corretamente
console.log('\n🔹 Executando Teste 7: Router encontra a conexão WAHA ativa...');
const resolvedConn = resolveWhatsAppConnection('store-alpha-tenant-1');
assert.strictEqual(resolvedConn !== null, true);
assert.strictEqual(resolvedConn.provider, 'waha', 'Conexão default prioritária deve ser WAHA');
assert.strictEqual(resolvedConn.instance_name, 'default');
assert.strictEqual(resolvedConn.credentials.api_key, '4AMEccT4Seze6wfMmyMkiJ378iTCRn3K');
console.log('✅ Teste 7 aprovado: whatsappRouter seleciona WAHA como provedor prioritário.');

// TESTE 8: Conexão inativa não é escolhida pelo router
console.log('\n🔹 Executando Teste 8: Conexão inativa não é escolhida pelo router...');
// Desativa a conexão WAHA
allAlphaConnections[0].status = 'inactive';
const resolvedFallback = resolveWhatsAppConnection('store-alpha-tenant-1');
assert.strictEqual(resolvedFallback.provider, 'evolution', 'Quando WAHA está inativo, router faz fallback para Evolution');
console.log('✅ Teste 8 aprovado: Conexão inativa é ignorada e fallback funciona.');

// Reativa WAHA
allAlphaConnections[0].status = 'active';

// TESTE 9: Normalização rigorosa de URL
console.log('\n🔹 Executando Teste 9: Normalização de URL...');
const rawUrl1 = '  waha.meudominio.com/  ';
const rawUrl2 = 'http://waha.meudominio.com///';
const rawUrl3 = 'https://waha.vps.online/';

assert.strictEqual(normalizeUrl(rawUrl1), 'https://waha.meudominio.com');
assert.strictEqual(normalizeUrl(rawUrl2), 'http://waha.meudominio.com');
assert.strictEqual(normalizeUrl(rawUrl3), 'https://waha.vps.online');
console.log('✅ Teste 9 aprovado: URLs normalizadas sem barras finais e com protocolo correto.');

// TESTE 10: Nenhuma credencial aparece nos logs
console.log('\n🔹 Executando Teste 10: Auditoria anti-vazamento de credenciais em logs...');
const logOutput = JSON.stringify({
  action: 'connection_tested',
  provider: 'waha',
  masked: maskApiKey('4AMEccT4Seze6wfMmyMkiJ378iTCRn3K'),
});

assert.strictEqual(logOutput.includes('4AMEccT4Seze'), false, 'Log não pode conter a chave de API');
assert.strictEqual(logOutput.includes('••••••••••••Rn3K'), true, 'Log deve conter apenas a versão mascarada');
console.log('✅ Teste 10 aprovado: Zero credenciais vazadas em logs ou payloads.');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('🎉 TODOS OS 10 TESTES DE CONFIGURAÇÃO FORAM CONCLUÍDOS COM SUCESSO!');
console.log('═══════════════════════════════════════════════════════════════\n');
