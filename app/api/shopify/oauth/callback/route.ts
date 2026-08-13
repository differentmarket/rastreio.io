import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const shop = searchParams.get('shop');

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

  // Salvar domínio e token no banco de dados
  await supabaseAdmin.from('settings').upsert([
    { key: 'SHOPIFY_STORE_DOMAIN', value: shop },
    { key: 'SHOPIFY_ADMIN_TOKEN', value: access_token },
  ], { onConflict: 'key' });

  console.log(`✅ Shopify OAuth concluído! Loja: ${shop}`);

  // Redirecionar para o painel admin após instalar
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
  return NextResponse.redirect(`${appUrl}/admin?shopify_connected=1`);
}
