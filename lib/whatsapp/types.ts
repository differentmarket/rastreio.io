/**
 * Tipagens e Contratos Universais do WhatsApp Provider Router (Rastreio.IO)
 */

export type WhatsAppProvider = 'evolution' | 'waha' | 'meta_cloud';

export interface WhatsAppConnectionRecord {
  id: string;
  store_id: string;
  provider: WhatsAppProvider;
  instance_name: string; // Evolution: instance | WAHA: session | Meta: phone_number_id
  api_url: string;
  credentials: {
    api_key?: string;
    token?: string;
    secret?: string;
    [key: string]: any;
  };
  priority: number;
  status: 'active' | 'inactive' | 'connecting' | 'disconnected';
  is_default: boolean;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface IncomingWhatsAppMessage {
  provider: WhatsAppProvider;
  storeId?: string;
  instanceName: string;
  messageId: string;
  remoteJid: string;
  phoneClean: string;
  messageText: string;
  pushName?: string;
  fromMe: boolean;
  rawPayload?: any;
}

export interface NormalizedPayloadResult {
  isFromMe: boolean;
  hasMessageContent: boolean;
  message?: IncomingWhatsAppMessage | null;
  instanceName?: string;
  reason?: string;
}

export interface SendWhatsAppParams {
  apiUrl: string;
  credentials: {
    api_key?: string;
    token?: string;
    [key: string]: any;
  };
  instanceName: string;
  recipientPhone: string; // apenas dígitos (ex: 5511999998888)
  text: string;
  delayMs?: number;
}

export interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface IWhatsAppAdapter {
  readonly provider: WhatsAppProvider;
  normalizePayload(rawPayload: any): NormalizedPayloadResult;
  sendMessage(params: SendWhatsAppParams): Promise<SendWhatsAppResult>;
}
