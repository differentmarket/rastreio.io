import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const clientId = process.env.SHOPIFY_CLIENT_ID || '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
  const shop = req.nextUrl.searchParams.get('shop') || 'lojazona420.myshopify.com';

  const scopes = [
    'read_orders',
    'write_orders',
    'read_fulfillments',
    'write_fulfillments',
    'read_merchant_managed_fulfillment_orders',
    'write_merchant_managed_fulfillment_orders',
  ].join(',');

  const redirectUri = `${appUrl}/api/shopify/oauth/callback`;
  const state = Math.random().toString(36).substring(2);

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${clientId}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return NextResponse.redirect(authUrl);
}
