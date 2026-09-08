import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTenantAccess } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

const SENSITIVE_SETTINGS_KEYS = [
  'SHOPIFY_ADMIN_TOKEN',
  'SHOPIFY_WEBHOOK_SECRET',
  'SHOPIFY_CLIENT_SECRET',
  'RESEND_API_KEY',
  'GATEWAY_WEBHOOK_SECRET',
];

function isMaskedValue(val: any): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed.includes('•') || trimmed.includes('*');
}

export async function GET(req: NextRequest) {
  try {
    const tenant = await validateTenantAccess(req, null);
    if (!tenant.authorized) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    // Regra estrita: apenas Superadmin tem acesso às configurações globais do sistema
    if (!tenant.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Acesso negado: apenas superadministradores podem acessar as configurações globais do sistema.' },
        { status: 403 }
      );
    }

    // Bypass com mock em ambiente local
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl.includes('mock-project')) {
      return NextResponse.json({
        SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN || 'mock-store.myshopify.com',
        SHOPIFY_ADMIN_TOKEN: '••••••••',
        SHOPIFY_WEBHOOK_SECRET: '••••••••',
        DELAY_POSTADO_EM_TRANSITO: '2',
        DELAY_EM_TRANSITO_SAIU_ENTREGA: '3',
        DELAY_SAIU_ENTREGA_ENTREGUE: '1',
        EMPRESA_NOME: 'Minha Empresa Ltda',
        EMPRESA_CNPJ: '00.000.000/0001-00',
        EMPRESA_ENDERECO: 'Rua Principal, 100',
        EMPRESA_CIDADE: 'São Paulo',
        EMPRESA_ESTADO: 'SP',
        EMPRESA_CEP: '01000-000',
        RESEND_API_KEY: '••••••••',
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
      config[item.key] = item.value;
    });

    // Mascarar segredos sensíveis: nunca expor chaves cruas em JSON
    for (const key of SENSITIVE_SETTINGS_KEYS) {
      if (config[key]) {
        config[key] = '••••••••';
      }
    }

    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await validateTenantAccess(req, null);
    if (!tenant.authorized) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    // Regra estrita: apenas Superadmin pode alterar configurações globais do sistema
    if (!tenant.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Acesso negado: apenas superadministradores podem alterar configurações globais do sistema.' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // Bypass mock em ambiente local
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl.includes('mock-project')) {
      return NextResponse.json({ ok: true });
    }

    // Salva as chaves enviadas no body, ignorando campos sensíveis mascarados com "••••••••"
    for (const [key, val] of Object.entries(body)) {
      if (SENSITIVE_SETTINGS_KEYS.includes(key) && isMaskedValue(val)) {
        // Ignora a alteração deste campo mascarado para preservar o segredo real existente
        continue;
      }

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
