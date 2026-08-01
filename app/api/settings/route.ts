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

    // Bypass com mock em ambiente local
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl.includes('mock-project')) {
      return NextResponse.json({
        SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN || 'mock-store.myshopify.com',
        SHOPIFY_ADMIN_TOKEN: 'shpat_mock_token_secret_value_123',
        SHOPIFY_WEBHOOK_SECRET: 'mock_webhook_secret_value',
        DELAY_POSTADO_EM_TRANSITO: '2',
        DELAY_EM_TRANSITO_SAIU_ENTREGA: '3',
        DELAY_SAIU_ENTREGA_ENTREGUE: '1',
      });
    }

    const { data: settings, error } = await supabaseAdmin
      .from('settings')
      .select('key, value');

    if (error) {
      console.error('Erro ao ler configurações do banco:', error);
      return NextResponse.json({ error: 'Erro ao carregar configurações.' }, { status: 500 });
    }

    const config: Record<string, string> = {
      SHOPIFY_STORE_DOMAIN: '',
      SHOPIFY_ADMIN_TOKEN: '',
      SHOPIFY_WEBHOOK_SECRET: '',
      DELAY_POSTADO_EM_TRANSITO: '2', // valor padrão
      DELAY_EM_TRANSITO_SAIU_ENTREGA: '3', // valor padrão
      DELAY_SAIU_ENTREGA_ENTREGUE: '1', // valor padrão
    };

    settings?.forEach((item) => {
      if (item.key in config) {
        config[item.key] = item.value;
      }
    });

    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
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
      SHOPIFY_STORE_DOMAIN, 
      SHOPIFY_ADMIN_TOKEN, 
      SHOPIFY_WEBHOOK_SECRET,
      DELAY_POSTADO_EM_TRANSITO,
      DELAY_EM_TRANSITO_SAIU_ENTREGA,
      DELAY_SAIU_ENTREGA_ENTREGUE
    } = body;

    // Bypass mock em ambiente local (apenas simula sucesso)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl.includes('mock-project')) {
      return NextResponse.json({ ok: true });
    }

    const updates = [
      { key: 'SHOPIFY_STORE_DOMAIN', value: SHOPIFY_STORE_DOMAIN || '' },
      { key: 'SHOPIFY_ADMIN_TOKEN', value: SHOPIFY_ADMIN_TOKEN || '' },
      { key: 'SHOPIFY_WEBHOOK_SECRET', value: SHOPIFY_WEBHOOK_SECRET || '' },
      { key: 'DELAY_POSTADO_EM_TRANSITO', value: String(DELAY_POSTADO_EM_TRANSITO ?? '2') },
      { key: 'DELAY_EM_TRANSITO_SAIU_ENTREGA', value: String(DELAY_EM_TRANSITO_SAIU_ENTREGA ?? '3') },
      { key: 'DELAY_SAIU_ENTREGA_ENTREGUE', value: String(DELAY_SAIU_ENTREGA_ENTREGUE ?? '1') },
    ];

    for (const item of updates) {
      const { error } = await supabaseAdmin
        .from('settings')
        .upsert({ key: item.key, value: item.value }, { onConflict: 'key' });

      if (error) {
        console.error(`Erro ao salvar configuração ${item.key}:`, error);
        return NextResponse.json({ error: `Erro ao salvar ${item.key}.` }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
