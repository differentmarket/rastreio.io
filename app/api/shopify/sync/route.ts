import { NextRequest, NextResponse } from 'next/server';
import { validateTenantAccess } from '@/lib/authHelper';
import { executarSincronizacaoShopify } from '@/lib/shopifySyncHelper';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeIdParam = searchParams.get('store_id') || undefined;

    // Validação estrita de Tenant
    const tenant = await validateTenantAccess(req, storeIdParam);
    if (!tenant.authorized) {
      return NextResponse.json({ error: tenant.error || 'Acesso negado a esta loja.' }, { status: tenant.status });
    }

    // Se usuário comum não passou store_id, sincroniza a loja autorizada dele
    const targetStore = tenant.targetStoreId || (tenant.isSuperAdmin ? undefined : tenant.allowedStoreIds[0]);
    if (!targetStore && !tenant.isSuperAdmin) {
      return NextResponse.json({ error: 'Nenhuma loja autorizada encontrada para sincronização.' }, { status: 400 });
    }

    const res = await executarSincronizacaoShopify(targetStore);

    return NextResponse.json({
      success: true,
      ...res,
    });
  } catch (err: any) {
    console.error('Erro na sincronização com Shopify:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}

