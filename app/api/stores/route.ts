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

    // Se não for ambiente de testes mock e tivermos o userId, filtramos apenas as lojas do lojista
    if (!isMock && userId) {
      const { data: userBinds } = await supabaseAdmin
        .from('store_users')
        .select('store_id')
        .eq('user_id', userId);

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

    // Se a tabela stores existir mas estiver vazia, auto-migra a loja cadastrada nas settings legadas
    let finalStores = stores || [];
    if (finalStores.length === 0) {
      const { data: settings } = await supabaseAdmin.from('settings').select('key, value');
      const cfg: Record<string, string> = {};
      settings?.forEach(s => { cfg[s.key] = s.value; });

      const defaultDomain = cfg['SHOPIFY_STORE_DOMAIN'];
      const defaultToken  = cfg['SHOPIFY_ADMIN_TOKEN'];
      const empresaNome   = cfg['EMPRESA_NOME'] || 'Loja Principal';

      if (defaultDomain) {
        // Insere a loja legada na tabela stores
        const { data: autoCreatedStore } = await supabaseAdmin
          .from('stores')
          .insert({
            nome_loja: empresaNome,
            shopify_domain: defaultDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
            shopify_access_token: defaultToken || null,
            shopify_webhook_secret: cfg['SHOPIFY_WEBHOOK_SECRET'] || null,
            status: 'ativa',
            empresa_nome: empresaNome,
            empresa_cnpj: cfg['EMPRESA_CNPJ'] || null,
            empresa_endereco: cfg['EMPRESA_ENDERECO'] || null,
            empresa_cidade: cfg['EMPRESA_CIDADE'] || null,
            empresa_estado: cfg['EMPRESA_ESTADO'] || null,
            empresa_cep: cfg['EMPRESA_CEP'] || null,
          })
          .select()
          .single();

        if (autoCreatedStore) {
          finalStores = [autoCreatedStore];
          // Associa os pedidos e rastreios existentes sem store_id a esta loja
          await supabaseAdmin.from('orders').update({ store_id: autoCreatedStore.id }).is('store_id', null);
          await supabaseAdmin.from('trackings').update({ store_id: autoCreatedStore.id }).is('store_id', null);
          
          // Associa o usuário atual como proprietário da loja auto-criada no store_users
          if (userId) {
            await supabaseAdmin.from('store_users').upsert({
              user_id: userId,
              user_email: userEmail,
              store_id: autoCreatedStore.id,
              role: 'owner',
            }, { onConflict: 'user_id,store_id' });
          }
        }
      }
    }

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
        if (user) {
          await supabaseAdmin.from('store_users').upsert({
            user_id: user.id,
            user_email: user.email || '',
            store_id: newStore.id,
            role: 'owner',
          }, { onConflict: 'user_id,store_id' });
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

    const { error } = await supabaseAdmin.from('stores').delete().eq('id', storeId);
    if (error) {
      console.warn('Aviso ao excluir loja:', error.message);
    }

    return NextResponse.json({ success: true, message: 'Loja desconectada com sucesso.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro ao desconectar loja.' }, { status: 500 });
  }
}
