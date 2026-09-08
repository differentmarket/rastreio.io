import {
  IWhatsAppAdapter,
  NormalizedPayloadResult,
  SendWhatsAppParams,
  SendWhatsAppResult,
  WhatsAppProvider,
} from '../types';

/**
 * Utilitário com timeout e retry para requisições HTTP da Evolution API
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
      lastError = new Error(`Evolution HTTP ${res.status}: ${res.statusText}`);
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError || new Error(`Falha na Evolution API após ${maxRetries + 1} tentativas.`);
}

export class EvolutionAdapter implements IWhatsAppAdapter {
  readonly provider: WhatsAppProvider = 'evolution';

  /**
   * Normaliza payload bruto de webhook vindo da Evolution API
   */
  normalizePayload(rawPayload: any): NormalizedPayloadResult {
    const instance = (rawPayload?.instance || '').trim();
    const data = rawPayload?.data;

    const fromMe = Boolean(data?.key?.fromMe);
    if (fromMe) {
      return {
        isFromMe: true,
        hasMessageContent: false,
        instanceName: instance,
        reason: 'Mensagem enviada pelo próprio bot/atendente na Evolution',
      };
    }

    const remoteJid = data?.key?.remoteJid || '';
    const phoneClean = remoteJid.split('@')[0].replace(/\D/g, '');
    const messageText = (data?.message?.conversation || data?.message?.extendedTextMessage?.text || '').trim();
    const messageId = data?.key?.id || `${phoneClean}_${Date.now()}`;
    const pushName = data?.pushName || undefined;

    if (!remoteJid || !messageText) {
      return {
        isFromMe: false,
        hasMessageContent: false,
        instanceName: instance,
        reason: 'Payload Evolution sem identificador de remetente ou sem texto',
      };
    }

    return {
      isFromMe: false,
      hasMessageContent: true,
      instanceName: instance,
      message: {
        provider: 'evolution',
        instanceName: instance,
        messageId,
        remoteJid,
        phoneClean,
        messageText,
        pushName,
        fromMe: false,
        rawPayload,
      },
    };
  }

  /**
   * Envia mensagem de texto via endpoint oficial da Evolution API (POST /message/sendText/{instance})
   */
  async sendMessage(params: SendWhatsAppParams): Promise<SendWhatsAppResult> {
    const { apiUrl, credentials, instanceName, recipientPhone, text, delayMs = 1200 } = params;

    const apiKey = credentials.api_key || credentials.token || '';
    if (!apiUrl || !instanceName || !recipientPhone || !text) {
      return {
        success: false,
        error: 'Parâmetros obrigatórios ausentes para envio via Evolution API.',
      };
    }

    const cleanPhone = recipientPhone.replace(/\D/g, '');
    const endpoint = `${apiUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`;

    try {
      const response = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
          },
          body: JSON.stringify({
            number: cleanPhone,
            text,
            delay: delayMs,
          }),
        },
        2,
        7000
      );

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          error: responseData?.message || `Evolution HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return {
        success: true,
        messageId: responseData?.key?.id || undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Exceção ao enviar mensagem pela Evolution API: ${err.message || err}`,
      };
    }
  }
}

export const evolutionAdapter = new EvolutionAdapter();
