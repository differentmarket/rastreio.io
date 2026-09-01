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
        EMPRESA_NOME: 'Minha Empresa Ltda',
        EMPRESA_CNPJ: '00.000.000/0001-00',
        EMPRESA_ENDERECO: 'Rua Principal, 100',
        EMPRESA_CIDADE: 'São Paulo',
        EMPRESA_ESTADO: 'SP',
        EMPRESA_CEP: '01000-000',
        RESEND_API_KEY: 're_mock_key_value_456',
        RESEND_FROM_EMAIL: 'Rastreio <noreply@seudominio.com>',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
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
      SHOPIFY_CLIENT_ID: '',
      SHOPIFY_CLIENT_SECRET: '',
      DELAY_POSTADO_EM_TRANSITO: '2',
      DELAY_EM_TRANSITO_SAIU_ENTREGA: '3',
      DELAY_SAIU_ENTREGA_ENTREGUE: '1',
      EMPRESA_NOME: '',
      EMPRESA_CNPJ: '',
      EMPRESA_ENDERECO: '',
      EMPRESA_CIDADE: '',
      EMPRESA_ESTADO: '',
      EMPRESA_CEP: '',
      RESEND_API_KEY: '',
      RESEND_FROM_EMAIL: '',
      NEXT_PUBLIC_APP_URL: '',
      NOTA_DELAY_HORAS: '2',
      RASTREIO_PROXIMO_DIA_UTIL: 'true',
      AUTOMACAO_ATIVA: 'false',
      GATEWAY_WEBHOOK_URL: '',
      GATEWAY_WEBHOOK_SECRET: '',
    };

    settings?.forEach((item) => {
      // Aceitar qualquer chave do banco, não só as do config inicial
      config[item.key] = item.value;
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
      DELAY_SAIU_ENTREGA_ENTREGUE,
      EMPRESA_NOME,
      EMPRESA_CNPJ,
      EMPRESA_ENDERECO,
      EMPRESA_CIDADE,
      EMPRESA_ESTADO,
      EMPRESA_CEP,
      RESEND_API_KEY,
      RESEND_FROM_EMAIL,
      NEXT_PUBLIC_APP_URL,
      NOTA_DELAY_HORAS,
      RASTREIO_PROXIMO_DIA_UTIL,
      AUTOMACAO_ATIVA,
    } = body;

    // Bypass mock em ambiente local (apenas simula sucesso)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl.includes('mock-project')) {
      return NextResponse.json({ ok: true });
    }

    // Salva todas as chaves enviadas no body
    for (const [key, val] of Object.entries(body)) {
      const { error } = await supabaseAdmin
        .from('settings')
        .upsert({ key, value: String(val ?? '') }, { onConflict: 'key' });

      if (error) {
        console.error(`Erro ao salvar configuração ${key}:`, error);
        return NextResponse.json({ error: `Erro ao salvar ${key}.` }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
