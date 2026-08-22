import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const shop = searchParams.get('shop');
  const state = searchParams.get('state');

  if (!code || !shop) {
    return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
  }

  let clientId = '';
  let clientSecret = '';
  let appUrl = '';

  try {
    const { data: settings } = await supabaseAdmin.from('settings').select('key, value');
    const cfg: Record<string, string> = {};
    settings?.forEach((s) => { cfg[s.key] = s.value; });

    if (cfg['SHOPIFY_CLIENT_ID']) {
      clientId = cfg['SHOPIFY_CLIENT_ID'].trim();
    }
    if (cfg['SHOPIFY_CLIENT_SECRET']) {
      clientSecret = cfg['SHOPIFY_CLIENT_SECRET'].trim();
    }
    if (cfg['NEXT_PUBLIC_APP_URL']) {
      appUrl = cfg['NEXT_PUBLIC_APP_URL'].trim();
    }
  } catch (e) {
    console.error('Erro ao buscar configurações no banco em /api/shopify/oauth/callback:', e);
  }

  // Fallback para variáveis de ambiente
  if (!clientId) {
    clientId = (process.env.SHOPIFY_CLIENT_ID || '').replace(/^\uFEFF/, '').trim();
  }
  if (!clientSecret) {
    clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').replace(/^\uFEFF/, '').trim();
  }
  if (!appUrl) {
    appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
  }

  if (!appUrl) {
    appUrl = 'https://rastreio-io.vercel.app';
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Credenciais SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET não configuradas.' }, { status: 400 });
  }

  // Trocar o code pelo access_token permanente
  const cleanShop = shop.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const tokenRes = await fetch(`https://${cleanShop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('Erro ao trocar code por token:', err);
    return NextResponse.json({ error: 'Falha ao obter token da Shopify.' }, { status: 502 });
  }

  const { access_token } = await tokenRes.json();

  // Salvar domínio e token no banco de dados (SaaS Multi-Tenant se state for UUID, senão Legacy Settings)
  if (state && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state)) {
    const { error: updateErr } = await supabaseAdmin
      .from('stores')
      .update({
        shopify_access_token: access_token,
        shopify_domain: cleanShop,
        status: 'ativa',
        updated_at: new Date().toISOString(),
      })
      .eq('id', state);

    if (updateErr) {
      console.error('Erro ao atualizar token na tabela stores:', updateErr);
      return NextResponse.json({ error: 'Erro ao atualizar dados da loja integrada.' }, { status: 500 });
    }

    console.log(`✅ Shopify OAuth concluído para loja SaaS! ID: ${state}, Loja: ${shop}`);
    return NextResponse.redirect(`${appUrl}/admin?shopify_connected=1&store_id=${state}`);
  } else {
    await supabaseAdmin.from('settings').upsert([
      { key: 'SHOPIFY_STORE_DOMAIN', value: shop },
      { key: 'SHOPIFY_ADMIN_TOKEN', value: access_token },
    ], { onConflict: 'key' });

    console.log(`✅ Shopify OAuth concluído (Legacy)! Loja: ${shop}`);
    return NextResponse.redirect(`${appUrl}/admin?shopify_connected=1`);
  }
}
