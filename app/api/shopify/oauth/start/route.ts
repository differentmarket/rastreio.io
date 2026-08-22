import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  let clientId = (process.env.SHOPIFY_CLIENT_ID || '').replace(/^\uFEFF/, '').trim();
  let appUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  if (!clientId || !appUrl) {
    try {
      const { data: settings } = await supabaseAdmin.from('settings').select('key, value');
      const cfg: Record<string, string> = {};
      settings?.forEach((s) => { cfg[s.key] = s.value; });

      if (!clientId && cfg['SHOPIFY_CLIENT_ID']) {
        clientId = cfg['SHOPIFY_CLIENT_ID'].trim();
      }
      if (!appUrl && cfg['NEXT_PUBLIC_APP_URL']) {
        appUrl = cfg['NEXT_PUBLIC_APP_URL'].trim();
      }
    } catch (e) {
      console.error('Erro ao buscar configurações no banco em /api/shopify/oauth/start:', e);
    }
  }

  if (!appUrl) {
    appUrl = 'https://rastreio-io.vercel.app';
  }

  const shop = req.nextUrl.searchParams.get('shop') || '';
  if (!shop) {
    return NextResponse.json({ error: 'Parâmetro shop é obrigatório.' }, { status: 400 });
  }

  if (!clientId) {
    return NextResponse.json({ error: 'SHOPIFY_CLIENT_ID não configurado. Configure no painel Admin em Configurações do Sistema.' }, { status: 400 });
  }

  const scopes = [
    'read_orders',
    'write_orders',
    'read_fulfillments',
    'write_fulfillments',
    'read_merchant_managed_fulfillment_orders',
    'write_merchant_managed_fulfillment_orders',
  ].join(',');

  const redirectUri = `${appUrl}/api/shopify/oauth/callback`;
  const storeId = req.nextUrl.searchParams.get('store_id') || '';
  const state = storeId || Math.random().toString(36).substring(2);

  const cleanShop = shop.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const authUrl =
    `https://${cleanShop}/admin/oauth/authorize` +
    `?client_id=${clientId}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return NextResponse.redirect(authUrl);
}
