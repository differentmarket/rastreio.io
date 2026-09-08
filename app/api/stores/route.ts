import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTenantAccess } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

function isMaskedValue(val: any): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed.includes('•') || trimmed.includes('*');
}

const STORE_SECRET_FIELDS = [
  'shopify_access_token',
  'shopify_webhook_secret',
  'resend_api_key',
  'evolution_api_key',
  'openai_api_key',
  'veopag_client_secret',
];

export async function GET(req: NextRequest) {
  try {
    const tenant = await validateTenantAccess(req, null);
    if (!tenant.authorized) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const isMock = supabaseUrl.includes('mock-project') || 
                   !process.env.SUPABASE_SERVICE_ROLE_KEY || 
                   process.env.SUPABASE_SERVICE_ROLE_KEY === 'mock-service-role-key';

    // Tentar buscar da tabela stores no Supabase
    let query = supabaseAdmin.from('stores').select('*');

    // Se não for superadmin, restringe estritamente às lojas autorizadas do lojista
    if (!tenant.isSuperAdmin) {
      query = query.in('id', tenant.allowedStoreIds);
    }

    const { data: stores, error } = await query.order('created_at', { ascending: false });

    if (error) {
      // Se a tabela stores não existir no banco ainda, gera fallback com a loja padrão configurada no settings
      const { data: settings } = await supabaseAdmin.from('settings').select('key, value');
      const cfg: Record<string, string> = {};
      settings?.forEach(s => { cfg[s.key] = s.value; });

      const defaultDomain = cfg['SHOPIFY_STORE_DOMAIN'] || 'sualoja.myshopify.com';
      const defaultToken  = cfg['SHOPIFY_ADMIN_TOKEN'] || '';
      const empresaNome   = cfg['EMPRESA_NOME'] || 'Loja Principal';

      // Contagem de pedidos totais
      const { count: orderCount } = await supabaseAdmin.from('orders').select('*', { count: 'exact', head: true });

      const fallbackStores = [{
        id: 'default-store',
        nome_loja: empresaNome,
        shopify_domain: defaultDomain,
        shopify_access_token: defaultToken ? '••••••••' : null,
        status: defaultToken ? 'ativa' : 'pausada',
        empresa_nome: empresaNome,
        empresa_cnpj: cfg['EMPRESA_CNPJ'] || '',
        empresa_cidade: cfg['EMPRESA_CIDADE'] || '',
        total_pedidos: orderCount || 0,
        created_at: new Date().toISOString(),
      }];

      return NextResponse.json({ stores: fallbackStores, totalStores: 1 });
    }

    // Retorna as lojas cadastradas com saneamento e enriquecimento
    let finalStores = stores || [];

    // Mapear permissões do usuário por loja
    const { data: userBinds } = tenant.user?.email
      ? await supabaseAdmin.from('store_users').select('store_id, role').eq('user_email', tenant.user.email)
      : { data: [] };
    const roleMap = new Map<string, string>((userBinds || []).map((b: any) => [b.store_id, b.role]));

    // Para cada loja, enriquecer com métricas de pedidos e sanitizar secrets conforme a role
    const enrichedStores = await Promise.all(finalStores.map(async (store: any) => {
      const { count: totalPedidos } = await supabaseAdmin
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store.id);

      const userRole = tenant.isSuperAdmin ? 'superadmin' : (roleMap.get(store.id) || 'member');
      const sanitizedStore = {
        ...store,
        total_pedidos: totalPedidos || 0,
      };

      if (userRole === 'member') {
        // Membros comuns NUNCA recebem secrets (retornam null)
        for (const field of STORE_SECRET_FIELDS) {
          sanitizedStore[field] = null;
        }
      } else {
        // Owner e Superadmin: todos os segredos são mascarados com "••••••••" para segurança
        for (const field of STORE_SECRET_FIELDS) {
          sanitizedStore[field] = store[field] ? '••••••••' : null;
        }
      }

      return sanitizedStore;
    }));

    return NextResponse.json({ stores: enrichedStores, totalStores: enrichedStores.length });
  } catch (err: any) {
    console.error('Erro na API de stores:', err);
    return NextResponse.json({ error: err.message || 'Erro interno ao listar lojas.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await validateTenantAccess(req, null);
    if (!tenant.authorized) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      nome_loja,
      shopify_domain,
      shopify_access_token,
      shopify_webhook_secret,
      empresa_nome,
      empresa_cnpj,
      empresa_endereco,
      empresa_cidade,
      empresa_estado,
      empresa_cep,
      taxa_enabled,
      taxa_nome,
      taxa_valor,
      taxa_link_pagamento,
      taxa_dias_tentativas,
      taxa_dia_exibicao,
      order_bump_bradesco_enabled,
      order_bump_bradesco_valor,
      order_bump_express_enabled,
      order_bump_express_valor,
      upsell_enabled,
      upsell_title,
      upsell_description,
      upsell_coupon,
      upsell_link,
      upsell_image_url,
      resend_from_email,
      resend_api_key,
    } = body;

    if (!shopify_domain) {
      return NextResponse.json({ error: 'O domínio da loja Shopify é obrigatório.' }, { status: 422 });
    }

    // Normalizar domínio (ex: remover https:// e barras)
    const cleanDomain = shopify_domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');

    // 1. Verificar se o domínio Shopify já existe em outro tenant para impedir takeover
    const { data: existingStore } = await supabaseAdmin
      .from('stores')
      .select('id, shopify_domain')
      .ilike('shopify_domain', cleanDomain)
      .maybeSingle();

    if (existingStore) {
      const isOwnerOfExisting = tenant.allowedStoreIds.includes(existingStore.id);
      if (!isOwnerOfExisting && !tenant.isSuperAdmin) {
        return NextResponse.json(
          { error: 'Este domínio Shopify já está integrado a outra loja ou usuário.' },
          { status: 409 }
        );
      }
    }

    // Sanitizar campos mascarados: nunca salvar "••••••••" no banco
    const safeAccessToken = isMaskedValue(shopify_access_token) ? null : (shopify_access_token || null);
    const safeWebhookSecret = isMaskedValue(shopify_webhook_secret) ? null : (shopify_webhook_secret || null);
    const safeResendApiKey = isMaskedValue(resend_api_key) ? null : (resend_api_key || null);

    const storePayload: any = {
      nome_loja: nome_loja || cleanDomain.split('.')[0],
      shopify_domain: cleanDomain,
      status: 'ativa',
      empresa_nome,
      empresa_cnpj,
      empresa_endereco,
      empresa_cidade,
      empresa_estado,
      empresa_cep,
      resend_from_email: resend_from_email || null,
      taxa_enabled: taxa_enabled !== undefined ? taxa_enabled : true,
      taxa_nome: taxa_nome || 'Taxa de Despacho Postal e Liberação Alfandegária',
      taxa_valor: taxa_valor !== undefined ? taxa_valor : 27.90,
      taxa_link_pagamento: taxa_link_pagamento || '',
      taxa_dias_tentativas: taxa_dias_tentativas || '9,10,11',
      taxa_dia_exibicao: taxa_dia_exibicao !== undefined ? taxa_dia_exibicao : 11,
      order_bump_bradesco_enabled: order_bump_bradesco_enabled !== undefined ? order_bump_bradesco_enabled : true,
      order_bump_bradesco_valor: order_bump_bradesco_valor !== undefined ? order_bump_bradesco_valor : 14.76,
      order_bump_express_enabled: order_bump_express_enabled !== undefined ? order_bump_express_enabled : true,
      order_bump_express_valor: order_bump_express_valor !== undefined ? order_bump_express_valor : 9.91,
      upsell_enabled: upsell_enabled !== undefined ? upsell_enabled : false,
      upsell_title: upsell_title || 'Ganhe 15% OFF na sua próxima compra!',
      upsell_description: upsell_description || 'Aproveite nossa condição exclusiva de frete grátis e desconto para clientes.',
      upsell_coupon: upsell_coupon || 'CLIENTE15',
      upsell_link: upsell_link || '',
      upsell_image_url: upsell_image_url || '',
      updated_at: new Date().toISOString(),
    };

    if (safeAccessToken !== null) storePayload.shopify_access_token = safeAccessToken;
    if (safeWebhookSecret !== null) storePayload.shopify_webhook_secret = safeWebhookSecret;
    if (safeResendApiKey !== null) storePayload.resend_api_key = safeResendApiKey;

    let savedStore: any = null;

    if (existingStore) {
      // Atualização permitida apenas para o dono legítimo ou superadmin
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('stores')
        .update(storePayload)
        .eq('id', existingStore.id)
        .select()
        .single();
      if (updErr) throw updErr;
      savedStore = updated;
    } else {
      // Inserção segura de nova loja
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('stores')
        .insert(storePayload)
        .select()
        .single();
      if (insErr) throw insErr;
      savedStore = inserted;
    }

    // Associar loja ao usuário autenticado como owner se for uma nova loja
    if (tenant.user?.email && savedStore?.id) {
      try {
        await supabaseAdmin.from('store_users').upsert({
          user_email: tenant.user.email,
          store_id: savedStore.id,
          role: 'owner',
        }, { onConflict: 'store_id,user_email' });
      } catch (bindErr) {
        console.error('Erro ao associar loja ao usuário no store_users:', bindErr);
      }
    }

    // Sanitizar a resposta antes de retornar ao frontend
    const sanitizedResponse = {
      ...savedStore,
      shopify_access_token: savedStore.shopify_access_token ? '••••••••' : null,
      shopify_webhook_secret: savedStore.shopify_webhook_secret ? '••••••••' : null,
      resend_api_key: savedStore.resend_api_key ? '••••••••' : null,
    };

    return NextResponse.json({
      success: true,
      message: 'Loja Shopify integrada com sucesso!',
      store: sanitizedResponse,
    });
  } catch (err: any) {
    console.error('Erro ao salvar nova loja:', err);
    return NextResponse.json({ error: err.message || 'Erro ao integrar loja.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, ...updateFields } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID da loja é obrigatório para atualização.' }, { status: 400 });
    }

    // Validação estrita de Tenant: somente owner ou superadmin pode alterar dados da loja
    const tenant = await validateTenantAccess(req, id);
    if (!tenant.authorized || (!tenant.isSuperAdmin && tenant.role !== 'owner')) {
      return NextResponse.json(
        { error: 'Acesso negado. Apenas o proprietário (owner) ou superadmin pode modificar as configurações desta loja.' },
        { status: 403 }
      );
    }

    // Proteger contra adulteração de credenciais críticas de conexão Shopify via PUT
    delete updateFields.shopify_domain;
    delete updateFields.shopify_access_token;

    // Se algum segredo veio mascarado ("••••••••"), deleta o campo para preservar o valor real existente no banco
    for (const field of STORE_SECRET_FIELDS) {
      if (isMaskedValue(updateFields[field])) {
        delete updateFields[field];
      }
    }

    let updatedStore: any = null;
    const { data: resStore, error } = await supabaseAdmin
      .from('stores')
      .update({
        ...updateFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error && (
      error.message?.includes('resend_from_email') || 
      error.message?.includes('resend_api_key') ||
      error.message?.includes('ai_recovery_delay_minutes') ||
      error.message?.includes('ai_initial_message')
    )) {
      const { 
        resend_from_email, resend_api_key, 
        ai_recovery_delay_minutes, ai_initial_message, 
        ...safeFields 
      } = updateFields;
      const fallbackResult = await supabaseAdmin
        .from('stores')
        .update({
          ...safeFields,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
      if (fallbackResult.error) throw fallbackResult.error;
      updatedStore = fallbackResult.data;
    } else if (error) {
      throw error;
    } else {
      updatedStore = resStore;
    }

    // Sanitizar a resposta
    const sanitizedResult = {
      ...updatedStore,
      shopify_access_token: updatedStore.shopify_access_token ? '••••••••' : null,
      shopify_webhook_secret: updatedStore.shopify_webhook_secret ? '••••••••' : null,
      resend_api_key: updatedStore.resend_api_key ? '••••••••' : null,
    };

    return NextResponse.json({ success: true, store: sanitizedResult });
  } catch (err: any) {
    console.error('Erro ao atualizar configurações da loja:', err);
    return NextResponse.json({ error: err.message || 'Erro ao atualizar loja.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('id');

    if (!storeId) {
      return NextResponse.json({ error: 'ID da loja não informado.' }, { status: 400 });
    }

    if (storeId === 'default-store') {
      const tenantDef = await validateTenantAccess(req, null);
      if (!tenantDef.authorized || (!tenantDef.isSuperAdmin && tenantDef.role !== 'owner')) {
        return NextResponse.json({ error: 'Acesso negado para desconectar loja padrão.' }, { status: 403 });
      }
      await supabaseAdmin.from('settings').update({ value: '' }).in('key', ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN', 'SHOPIFY_WEBHOOK_SECRET']);
      return NextResponse.json({ success: true, message: 'Loja padrão desconectada com sucesso.' });
    }

    // Validação de Tenant: somente owner ou superadmin pode excluir a loja
    const tenant = await validateTenantAccess(req, storeId);
    if (!tenant.authorized || (!tenant.isSuperAdmin && tenant.role !== 'owner')) {
      return NextResponse.json(
        { error: 'Acesso negado. Apenas o proprietário (owner) ou superadmin pode excluir esta loja.' },
        { status: 403 }
      );
    }

    // 1. Limpar vínculos de usuários da loja
    await supabaseAdmin.from('store_users').delete().eq('store_id', storeId);

    // 2. Limpar conversas de IA associadas
    await supabaseAdmin.from('ai_conversations').delete().eq('store_id', storeId);

    // 3. Buscar pedidos da loja para remover trackings e fila de emails
    const { data: storeOrders } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('store_id', storeId);

    if (storeOrders && storeOrders.length > 0) {
      const orderIds = storeOrders.map(o => o.id);
      await supabaseAdmin.from('email_queue').delete().in('order_id', orderIds);
      await supabaseAdmin.from('trackings').delete().in('order_id', orderIds);
      await supabaseAdmin.from('orders').delete().in('id', orderIds);
    }

    // 4. Limpar trackings remanescentes da loja (se houver)
    await supabaseAdmin.from('trackings').delete().eq('store_id', storeId);

    // 5. Excluir a loja
    const { error } = await supabaseAdmin.from('stores').delete().eq('id', storeId);
    if (error) {
      console.error('Erro ao excluir loja:', error);
      return NextResponse.json({ error: error.message || 'Erro ao excluir loja no banco.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Loja desconectada e excluída com sucesso.' });
  } catch (err: any) {
    console.error('Erro geral ao excluir loja:', err);
    return NextResponse.json({ error: err.message || 'Erro ao desconectar loja.' }, { status: 500 });
  }
}
