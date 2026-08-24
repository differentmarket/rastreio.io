import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/authHelper';
import { executarSincronizacaoShopify } from '@/lib/shopifySyncHelper';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const storeIdParam = searchParams.get('store_id') || undefined;

    const res = await executarSincronizacaoShopify(storeIdParam);

    return NextResponse.json({
      success: true,
      ...res,
    });
  } catch (err: any) {
    console.error('Erro na sincronização com Shopify:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
