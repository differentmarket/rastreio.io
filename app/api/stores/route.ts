import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    // Obter o token JWT do header de autorização
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.split(' ')[1] : null;
    let userId = null;
    let userEmail = '';
    
    if (token) {
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user) {
          userId = user.id;
          userEmail = user.email || '';
        }
      } catch (e) {
        console.error('Erro ao obter usuário a partir do token no GET /api/stores:', e);
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const isMock = supabaseUrl.includes('mock-project') || 
                   !process.env.SUPABASE_SERVICE_ROLE_KEY || 
                   process.env.SUPABASE_SERVICE_ROLE_KEY === 'mock-service-role-key';

    // Tentar buscar da tabela stores no Supabase
    let query = supabaseAdmin.from('stores').select('*');

    // Se não for ambiente de testes mock e tivermos o userEmail, filtramos apenas as lojas do lojista
    if (!isMock && userEmail) {
      // Auto-associar lojas órfãs (antigas) ao primeiro lojista que acessar o painel
      try {
        const { data: allStores } = await supabaseAdmin.from('stores').select('id');
        const { data: allBinds } = await supabaseAdmin.from('store_users').select('store_id');

        if (allStores) {
          const boundStoreIds = new Set(allBinds?.map(b => b.store_id) || []);
          const orphanStores = allStores.filter(s => !boundStoreIds.has(s.id));

          if (orphanStores.length > 0) {
            for (const s of orphanStores) {
              await supabaseAdmin.from('store_users').upsert({
                user_email: userEmail,
                store_id: s.id,
                role: 'owner',
              }, { onConflict: 'store_id,user_email' });
            }
          }
        }
      } catch (err) {
        console.error('Erro ao auto-associar lojas órfãs:', err);
      }

      const { data: userBinds } = await supabaseAdmin
        .from('store_users')
        .select('store_id')
        .eq('user_email', userEmail);

      const allowedStoreIds = userBinds?.map(b => b.store_id) || [];
      query = query.in('id', allowedStoreIds);
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

    // Retorna as lojas cadastradas
    let finalStores = stores || [];

    // Para cada loja, enriquecer com métricas de pedidos
    const enrichedStores = await Promise.all(finalStores.map(async (store: any) => {
      const { count: totalPedidos } = await supabaseAdmin
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store.id);

      return {
        ...store,
        shopify_access_token: store.shopify_access_token ? '••••••••' : null,
        total_pedidos: totalPedidos || 0,
      };
    }));

    return NextResponse.json({ stores: enrichedStores, totalStores: enrichedStores.length });
  } catch (err: any) {
    console.error('Erro na API de stores:', err);
    return NextResponse.json({ error: err.message || 'Erro interno ao listar lojas.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json();
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
    } = body;

    if (!shopify_domain) {
      return NextResponse.json({ error: 'O domínio da loja Shopify é obrigatório.' }, { status: 422 });
    }

    // Normalizar domínio (ex: remover https:// e barras)
    const cleanDomain = shopify_domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');

    // Inserir ou atualizar na tabela stores
    const { data: newStore, error } = await supabaseAdmin
      .from('stores')
      .upsert({
        nome_loja: nome_loja || cleanDomain.split('.')[0],
        shopify_domain: cleanDomain,
        shopify_access_token: shopify_access_token || null,
        shopify_webhook_secret: shopify_webhook_secret || null,
        status: 'ativa',
        empresa_nome,
        empresa_cnpj,
        empresa_endereco,
        empresa_cidade,
        empresa_estado,
        empresa_cep,
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
        updated_at: new Date().toISOString(),
      }, { onConflict: 'shopify_domain' })
      .select()
      .single();

    if (error) {
      // Se a tabela stores não existir, salva nas settings legadas como fallback
      if (error.message.includes('stores') || error.code === 'PGRST205') {
        await supabaseAdmin.from('settings').upsert([
          { key: 'SHOPIFY_STORE_DOMAIN', value: cleanDomain },
          { key: 'SHOPIFY_ADMIN_TOKEN', value: shopify_access_token || '' },
          { key: 'EMPRESA_NOME', value: empresa_nome || nome_loja || '' },
        ], { onConflict: 'key' });

        return NextResponse.json({
          success: true,
          message: 'Loja cadastrada nas configurações com sucesso!',
          store: { id: 'default-store', nome_loja, shopify_domain: cleanDomain, status: 'ativa' },
        });
      }
      throw error;
    }

    // Associar loja ao usuário autenticado (store_users)
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.split(' ')[1] : null;
    if (token && newStore) {
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user && user.email) {
          await supabaseAdmin.from('store_users').upsert({
            user_email: user.email,
            store_id: newStore.id,
            role: 'owner',
          }, { onConflict: 'store_id,user_email' });
        }
      } catch (err) {
        console.error('Erro ao associar loja ao usuário no store_users:', err);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Loja Shopify integrada com sucesso!',
      store: newStore,
    });
  } catch (err: any) {
    console.error('Erro ao salvar nova loja:', err);
    return NextResponse.json({ error: err.message || 'Erro ao integrar loja.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json();
    const { id, ...updateFields } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID da loja é obrigatório para atualização.' }, { status: 400 });
    }

    const { data: updatedStore, error } = await supabaseAdmin
      .from('stores')
      .update({
        ...updateFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, store: updatedStore });
  } catch (err: any) {
    console.error('Erro ao atualizar configurações da loja:', err);
    return NextResponse.json({ error: err.message || 'Erro ao atualizar loja.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('id');

    if (!storeId) {
      return NextResponse.json({ error: 'ID da loja não informado.' }, { status: 400 });
    }

    if (storeId === 'default-store') {
      await supabaseAdmin.from('settings').update({ value: '' }).in('key', ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN', 'SHOPIFY_WEBHOOK_SECRET']);
      return NextResponse.json({ success: true, message: 'Loja padrão desconectada com sucesso.' });
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
