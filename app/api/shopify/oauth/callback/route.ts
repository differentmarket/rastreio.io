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

  // Remove BOM (\uFEFF) que o PowerShell adiciona ao salvar env vars
  const clientId = (process.env.SHOPIFY_CLIENT_ID || '').replace(/^\uFEFF/, '').trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').replace(/^\uFEFF/, '').trim();

  // Trocar o code pelo access_token permanente
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
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
  const cleanShop = shop.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';

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
