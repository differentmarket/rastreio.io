import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { SendWhatsAppResult, WhatsAppConnectionRecord } from './types';
import { wahaAdapter } from './adapters/wahaAdapter';
import { evolutionAdapter } from './adapters/evolutionAdapter';

export interface SendWhatsAppReplyParams {
  storeId: string;
  store?: any;
  phone: string;
  text: string;
  instanceName?: string;
  delayMs?: number;
}

/**
 * Busca conexões ativas da loja em whatsapp_connections ordenadas por prioridade.
 */
export async function resolveActiveConnections(storeId: string): Promise<WhatsAppConnectionRecord[]> {
  try {
    const { data: connections, error } = await supabaseAdmin
      .from('whatsapp_connections')
      .select('*')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .order('priority', { ascending: true })
      .order('is_default', { ascending: false });

    if (error) {
      console.warn('[WhatsAppRouter] Erro ao consultar whatsapp_connections:', error.message);
      return [];
    }

    return (connections || []) as WhatsAppConnectionRecord[];
  } catch (err) {
    console.error('[WhatsAppRouter] Exceção ao consultar conexões:', err);
    return [];
  }
}

/**
 * Roteador universal de despacho de mensagens WhatsApp.
 * Decide qual provedor utilizar com base em whatsapp_connections (com prioridade)
 * e fallback garantido para a Evolution API legada em stores.
 */
export async function sendWhatsAppReply(params: SendWhatsAppReplyParams): Promise<SendWhatsAppResult> {
  const { storeId, store, phone, text, instanceName, delayMs } = params;

  if (!storeId || !phone || !text) {
    return {
      success: false,
      error: 'storeId, phone e text são obrigatórios para envio de WhatsApp.',
    };
  }

  // 1. Tenta obter conexões ativas na tabela whatsapp_connections
  const activeConnections = await resolveActiveConnections(storeId);

  if (activeConnections.length > 0) {
    let lastError = '';

    // Itera por ordem de prioridade (priority 1, 2, 3...)
    for (const conn of activeConnections) {
      try {
        const credentials = conn.credentials || {};

        if (conn.provider === 'waha') {
          const res = await wahaAdapter.sendMessage({
            apiUrl: conn.api_url,
            credentials,
            instanceName: conn.instance_name || instanceName || 'default',
            recipientPhone: phone,
            text,
            delayMs,
          });

          if (res.success) {
            return res;
          }
          lastError = res.error || 'Falha no envio via WAHA';
          console.warn(`[WhatsAppRouter] Falha no provider WAHA (Instância: ${conn.instance_name}): ${lastError}. Tentando próximo provider se houver...`);
        } else if (conn.provider === 'evolution') {
          const res = await evolutionAdapter.sendMessage({
            apiUrl: conn.api_url,
            credentials,
            instanceName: conn.instance_name || instanceName || '',
            recipientPhone: phone,
            text,
            delayMs,
          });

          if (res.success) {
            return res;
          }
          lastError = res.error || 'Falha no envio via Evolution';
          console.warn(`[WhatsAppRouter] Falha no provider Evolution (Instância: ${conn.instance_name}): ${lastError}. Tentando próximo provider se houver...`);
        }
      } catch (err: any) {
        lastError = err.message || err;
        console.error(`[WhatsAppRouter] Exceção no provider ${conn.provider}:`, err);
      }
    }

    return {
      success: false,
      error: `Todas as conexões ativas falharam. Último erro: ${lastError}`,
    };
  }

  // 2. Fallback Legado: Lojas que ainda possuem credenciais na tabela stores
  const storeData = store || (await getStoreFallback(storeId));

  const apiUrl = storeData?.evolution_api_url || process.env.EVOLUTION_API_URL;
  const apiKey = storeData?.evolution_api_key || process.env.EVOLUTION_API_KEY;
  const instName = storeData?.evolution_instance_name || instanceName;

  if (apiUrl && apiKey && instName) {
    return evolutionAdapter.sendMessage({
      apiUrl,
      credentials: { api_key: apiKey },
      instanceName: instName,
      recipientPhone: phone,
      text,
      delayMs,
    });
  }

  return {
    success: false,
    error: 'Nenhuma conexão ativa em whatsapp_connections e nenhuma credencial legada encontrada para esta loja.',
  };
}

async function getStoreFallback(storeId: string) {
  try {
    const { data } = await supabaseAdmin
      .from('stores')
      .select('id, evolution_api_url, evolution_api_key, evolution_instance_name')
      .eq('id', storeId)
      .maybeSingle();
    return data;
  } catch {
    return null;
  }
}
