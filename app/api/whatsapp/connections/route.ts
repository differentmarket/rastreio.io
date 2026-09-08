import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTenantAccess } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

function isMaskedValue(val: any): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed.includes('•') || trimmed.includes('*');
}

function maskApiKey(key: string | null | undefined): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 4) return '••••••••';
  return `••••••••••••${trimmed.slice(-4)}`;
}

function normalizeUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim();
  if (!url) return '';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

/**
 * GET /api/whatsapp/connections?store_id=...&provider=...
 * Consulta conexões da loja com chaves mascaradas por segurança.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('store_id');
    const providerFilter = searchParams.get('provider');

    if (!storeId) {
      return NextResponse.json(
        { error: 'Parâmetro store_id é obrigatório.' },
        { status: 400 }
      );
    }

    const tenant = await validateTenantAccess(req, storeId);
    if (!tenant.authorized) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    // 1. Busca conexões na tabela whatsapp_connections
    let query = supabaseAdmin
      .from('whatsapp_connections')
      .select('id, store_id, provider, instance_name, api_url, credentials, priority, status, is_default, metadata, created_at, updated_at')
      .eq('store_id', storeId)
      .order('priority', { ascending: true })
      .order('is_default', { ascending: false });

    if (providerFilter) {
      query = query.eq('provider', providerFilter);
    }

    const { data: connections, error: connErr } = await query;
    if (connErr) {
      throw connErr;
    }

    // 2. Busca também dados legados da loja para compatibilidade transparente com Evolution
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('evolution_api_url, evolution_api_key, evolution_instance_name, whatsapp_enabled')
      .eq('id', storeId)
      .maybeSingle();

    // 3. Mascara credenciais de todas as conexões
    const sanitizedConnections = (connections || []).map((c: any) => {
      const rawKey = c.credentials?.api_key || c.credentials?.token || '';
      return {
        ...c,
        credentials: {
          ...c.credentials,
          api_key: maskApiKey(rawKey),
        },
        has_api_key: Boolean(rawKey && rawKey.trim().length > 0),
      };
    });

    const legacyEvolution = store ? {
      evolution_api_url: store.evolution_api_url || '',
      evolution_instance_name: store.evolution_instance_name || '',
      evolution_api_key: maskApiKey(store.evolution_api_key),
      has_api_key: Boolean(store.evolution_api_key),
      whatsapp_enabled: Boolean(store.whatsapp_enabled),
    } : null;

    return NextResponse.json({
      success: true,
      connections: sanitizedConnections,
      legacy_evolution: legacyEvolution,
    });
  } catch (err: any) {
    console.error('Erro ao consultar whatsapp_connections:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Erro interno ao consultar conexões de WhatsApp.' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/connections
 * Cria ou atualiza conexão de WhatsApp (UPSERT) com isolamento rigoroso entre provedores.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      store_id,
      provider,
      instance_name,
      api_url,
      api_key,
      status,
      is_default,
      priority,
    } = body;

    if (!store_id) {
      return NextResponse.json({ error: 'store_id é obrigatório.' }, { status: 400 });
    }

    const tenant = await validateTenantAccess(req, store_id);
    if (!tenant.authorized || (!tenant.isSuperAdmin && tenant.role !== 'owner')) {
      return NextResponse.json(
        { error: 'Acesso negado. Apenas o proprietário (owner) ou superadmin pode configurar conexões de WhatsApp.' },
        { status: 403 }
      );
    }

    if (!provider || !['waha', 'evolution', 'meta_cloud'].includes(provider)) {
      return NextResponse.json(
        { error: 'Provedor inválido. Permitidos: "waha", "evolution", "meta_cloud".' },
        { status: 422 }
      );
    }

    const cleanInstanceName = (instance_name || '').trim();
    if (!cleanInstanceName) {
      return NextResponse.json(
        { error: provider === 'waha' ? 'Nome da sessão é obrigatório.' : 'Nome da instância é obrigatório.' },
        { status: 422 }
      );
    }

    const cleanApiUrl = normalizeUrl(api_url);
    if (!cleanApiUrl || (!cleanApiUrl.startsWith('http://') && !cleanApiUrl.startsWith('https://'))) {
      return NextResponse.json(
        { error: 'URL da API inválida. Informe uma URL válida (ex: https://waha.suaempresa.com).' },
        { status: 422 }
      );
    }

    // 1. Tratamento seguro de credenciais: preservar chave existente se vier mascarada
    let finalApiKey = (api_key || '').trim();
    if (isMaskedValue(finalApiKey) || !finalApiKey) {
      // Busca a chave existente no banco de dados para não sobrescrever com máscara
      const { data: existingConn } = await supabaseAdmin
        .from('whatsapp_connections')
        .select('credentials')
        .eq('store_id', store_id)
        .eq('provider', provider)
        .eq('instance_name', cleanInstanceName)
        .maybeSingle();

      if (existingConn?.credentials?.api_key) {
        finalApiKey = existingConn.credentials.api_key;
      } else if (provider === 'evolution') {
        // Fallback para loja legada
        const { data: store } = await supabaseAdmin
          .from('stores')
          .select('evolution_api_key')
          .eq('id', store_id)
          .maybeSingle();
        if (store?.evolution_api_key) {
          finalApiKey = store.evolution_api_key;
        }
      }
    }

    const isDefaultBool = is_default !== undefined ? Boolean(is_default) : true;
    const finalPriority = typeof priority === 'number' ? priority : 1;
    const finalStatus = status === 'inactive' ? 'inactive' : 'active';

    // 2. Se a conexão for definida como default, remove is_default de outras conexões da mesma loja
    if (isDefaultBool) {
      await supabaseAdmin
        .from('whatsapp_connections')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('store_id', store_id)
        .eq('is_default', true);
    }

    // 3. Executa UPSERT na tabela whatsapp_connections
    // UNIQUE(store_id, provider, instance_name) garante idempotência estrita sem duplicatas
    const upsertPayload = {
      store_id,
      provider,
      instance_name: cleanInstanceName,
      api_url: cleanApiUrl,
      credentials: { api_key: finalApiKey },
      priority: finalPriority,
      status: finalStatus,
      is_default: isDefaultBool,
      updated_at: new Date().toISOString(),
    };

    const { data: savedConnection, error: upsertErr } = await supabaseAdmin
      .from('whatsapp_connections')
      .upsert(upsertPayload, {
        onConflict: 'store_id,provider,instance_name',
      })
      .select('id, store_id, provider, instance_name, api_url, priority, status, is_default, created_at, updated_at')
      .single();

    if (upsertErr) {
      throw upsertErr;
    }

    // 4. TRAVA OBRIGATÓRIA:
    // Se for WAHA: NUNCA grava nada nas colunas stores.evolution_*
    // Se for Evolution: mantém espelhado em stores apenas para retrocompatibilidade
    if (provider === 'evolution') {
      await supabaseAdmin
        .from('stores')
        .update({
          evolution_api_url: cleanApiUrl,
          evolution_instance_name: cleanInstanceName,
          ...(finalApiKey ? { evolution_api_key: finalApiKey } : {}),
          whatsapp_enabled: finalStatus === 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', store_id);
    }

    // 5. Sanitiza a resposta antes de enviar ao frontend
    return NextResponse.json({
      success: true,
      message: `Conexão ${provider.toUpperCase()} salva com sucesso!`,
      connection: {
        ...savedConnection,
        credentials: {
          api_key: maskApiKey(finalApiKey),
        },
        has_api_key: Boolean(finalApiKey),
      },
    });
  } catch (err: any) {
    console.error('Erro ao salvar whatsapp_connection:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Erro interno ao salvar conexão de WhatsApp.' },
      { status: 500 }
    );
  }
}
