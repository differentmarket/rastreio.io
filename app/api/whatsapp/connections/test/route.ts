import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTenantAccess } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

function isMaskedValue(val: any): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed.includes('•') || trimmed.includes('*');
}

function normalizeUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim();
  if (!url) return '';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

/**
 * POST /api/whatsapp/connections/test
 * Testa a conexão com o provedor WhatsApp selecionado (WAHA ou Evolution)
 * SEM expor credenciais em logs ou respostas.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { store_id, provider, api_url, instance_name, api_key } = body;

    if (!store_id) {
      return NextResponse.json({ error: 'store_id é obrigatório.' }, { status: 400 });
    }

    const tenant = await validateTenantAccess(req, store_id);
    if (!tenant.authorized) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    if (!provider || !['waha', 'evolution'].includes(provider)) {
      return NextResponse.json({ error: 'Provedor para teste inválido.' }, { status: 422 });
    }

    const cleanApiUrl = normalizeUrl(api_url);
    if (!cleanApiUrl) {
      return NextResponse.json({ error: 'URL da API é obrigatória para teste.' }, { status: 422 });
    }

    const cleanInstance = (instance_name || '').trim();

    // 1. Resolução segura da API Key (recupera do banco se foi enviada mascarada)
    let testKey = (api_key || '').trim();
    if (isMaskedValue(testKey) || !testKey) {
      if (provider === 'waha') {
        const { data: conn } = await supabaseAdmin
          .from('whatsapp_connections')
          .select('credentials')
          .eq('store_id', store_id)
          .eq('provider', 'waha')
          .eq('instance_name', cleanInstance)
          .maybeSingle();

        testKey = conn?.credentials?.api_key || '';
      } else {
        const { data: conn } = await supabaseAdmin
          .from('whatsapp_connections')
          .select('credentials')
          .eq('store_id', store_id)
          .eq('provider', 'evolution')
          .eq('instance_name', cleanInstance)
          .maybeSingle();

        if (conn?.credentials?.api_key) {
          testKey = conn.credentials.api_key;
        } else {
          const { data: store } = await supabaseAdmin
            .from('stores')
            .select('evolution_api_key')
            .eq('id', store_id)
            .maybeSingle();
          testKey = store?.evolution_api_key || '';
        }
      }
    }

    // 2. Execução do teste conforme o provedor
    if (provider === 'waha') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      try {
        const headers: Record<string, string> = {
          'accept': 'application/json',
        };
        if (testKey) {
          headers['x-api-key'] = testKey;
        }

        // Tenta checar o status do servidor WAHA
        const versionRes = await fetch(`${cleanApiUrl}/api/server/version`, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (versionRes.ok) {
          const versionData = await versionRes.json().catch(() => ({}));
          return NextResponse.json({
            success: true,
            message: 'Conexão WAHA OK',
            details: {
              version: versionData.version || 'OK',
              engine: versionData.engine || 'WEBJS',
              tier: versionData.tier || 'CORE',
            },
          });
        }

        if (versionRes.status === 401 || versionRes.status === 403) {
          return NextResponse.json({
            success: false,
            message: 'Falha de autenticação: API Key do WAHA inválida ou não autorizada.',
          }, { status: 400 });
        }

        return NextResponse.json({
          success: false,
          message: `Servidor WAHA respondeu com status ${versionRes.status}.`,
        }, { status: 400 });
      } catch (fetchErr: any) {
        clearTimeout(timeout);
        const isTimeout = fetchErr.name === 'AbortError';
        return NextResponse.json({
          success: false,
          message: isTimeout
            ? 'Tempo limite de conexão esgotado (timeout de 6s). Verifique a URL do servidor WAHA.'
            : 'Não foi possível alcançar o servidor WAHA. Verifique a URL informada.',
        }, { status: 400 });
      }
    } else if (provider === 'evolution') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (testKey) {
          headers['apikey'] = testKey;
        }

        const evoUrl = cleanInstance
          ? `${cleanApiUrl}/instance/connectionState/${cleanInstance}`
          : `${cleanApiUrl}/instance/fetchInstances`;

        const evoRes = await fetch(evoUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (evoRes.ok) {
          return NextResponse.json({
            success: true,
            message: 'Conexão Evolution API OK',
          });
        }

        if (evoRes.status === 401 || evoRes.status === 403) {
          return NextResponse.json({
            success: false,
            message: 'Falha de autenticação: API Key da Evolution inválida.',
          }, { status: 400 });
        }

        return NextResponse.json({
          success: false,
          message: `Servidor Evolution respondeu com status ${evoRes.status}.`,
        }, { status: 400 });
      } catch (fetchErr: any) {
        clearTimeout(timeout);
        const isTimeout = fetchErr.name === 'AbortError';
        return NextResponse.json({
          success: false,
          message: isTimeout
            ? 'Tempo limite de conexão esgotado (timeout de 6s).'
            : 'Não foi possível alcançar o servidor Evolution. Verifique a URL informada.',
        }, { status: 400 });
      }
    }

    return NextResponse.json({ error: 'Provedor não suportado.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: 'Falha ao executar teste de conexão.' },
      { status: 500 }
    );
  }
}
