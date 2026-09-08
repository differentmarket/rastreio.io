import {
  IWhatsAppAdapter,
  NormalizedPayloadResult,
  SendWhatsAppParams,
  SendWhatsAppResult,
  WhatsAppProvider,
} from '../types';

/**
 * Utilitário com timeout e retry para requisições HTTP do WAHA
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
  timeoutMs = 8000
): Promise<Response> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok || res.status < 500) {
        return res;
      }
      lastError = new Error(`WAHA HTTP ${res.status}: ${res.statusText}`);
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError || new Error(`Falha no WAHA após ${maxRetries + 1} tentativas.`);
}

export class WahaAdapter implements IWhatsAppAdapter {
  readonly provider: WhatsAppProvider = 'waha';

  /**
   * Normaliza payload bruto de webhook vindo do WAHA (NOWEB / GOWS / WEBJS)
   */
  normalizePayload(rawPayload: any): NormalizedPayloadResult {
    const session = (rawPayload?.session || rawPayload?.name || 'default').trim();
    const payload = rawPayload?.payload || rawPayload?.data || {};

    const fromMe = Boolean(payload?.fromMe);
    if (fromMe) {
      return {
        isFromMe: true,
        hasMessageContent: false,
        instanceName: session,
        reason: 'Mensagem enviada pelo próprio bot/atendente no WAHA',
      };
    }

    const rawFrom = payload?.from || payload?.chatId || '';
    const phoneClean = rawFrom.split('@')[0].replace(/\D/g, '');
    const messageText = (payload?.body || payload?.text || '').trim();
    const messageId = payload?.id || `${phoneClean}_${Date.now()}`;
    const pushName = payload?._data?.notifyName || payload?.notifyName || undefined;

    if (!rawFrom || !messageText) {
      return {
        isFromMe: false,
        hasMessageContent: false,
        instanceName: session,
        reason: 'Payload WAHA sem identificador de remetente ou sem texto',
      };
    }

    return {
      isFromMe: false,
      hasMessageContent: true,
      instanceName: session,
      message: {
        provider: 'waha',
        instanceName: session,
        messageId,
        remoteJid: rawFrom,
        phoneClean,
        messageText,
        pushName,
        fromMe: false,
        rawPayload,
      },
    };
  }

  /**
   * Envia mensagem de texto via endpoint oficial do WAHA (POST /api/sendText)
   */
  async sendMessage(params: SendWhatsAppParams): Promise<SendWhatsAppResult> {
    const { apiUrl, credentials, instanceName, recipientPhone, text } = params;

    const apiKey = credentials.api_key || credentials.token || '';
    if (!apiUrl || !instanceName || !recipientPhone || !text) {
      return {
        success: false,
        error: 'Parâmetros obrigatórios ausentes para envio via WAHA.',
      };
    }

    // Formata chatId para o padrão do WAHA (@c.us)
    const cleanPhone = recipientPhone.replace(/\D/g, '');
    const chatId = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@c.us`;

    const endpoint = `${apiUrl.replace(/\/$/, '')}/api/sendText`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const response = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            session: instanceName,
            chatId,
            text,
          }),
        },
        2,
        7000
      );

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          error: responseData?.message || `WAHA HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return {
        success: true,
        messageId: responseData?.id || responseData?.messageId || undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Exceção ao enviar mensagem pelo WAHA: ${err.message || err}`,
      };
    }
  }
}

export const wahaAdapter = new WahaAdapter();
