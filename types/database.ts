export interface Customer {
  id: string;
  shopify_customer_id: number | null;
  nome: string;
  cpf_encrypted: Buffer | null;
  cpf_hash: string | null;
  email: string | null;
  telefone: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Address {
  id: string;
  customer_id: string;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null; // 2 caracteres
  cep: string | null;
  pais: string; // padrão 'BR'
  created_at?: string;
}

export interface Store {
  id: string;
  nome_loja: string;
  shopify_domain: string;
  shopify_access_token?: string | null;
  shopify_webhook_secret?: string | null;
  status: 'ativa' | 'pausada' | 'cancelada';
  empresa_nome?: string | null;
  empresa_cnpj?: string | null;
  empresa_endereco?: string | null;
  empresa_cidade?: string | null;
  empresa_estado?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  banner_url?: string | null;
  banner_link?: string | null;
  whatsapp_suporte?: string | null;
  evolution_api_url?: string | null;
  evolution_api_key?: string | null;
  evolution_instance_name?: string | null;
  whatsapp_enabled?: boolean;
  ai_recovery_enabled?: boolean;
  openai_api_key?: string | null;
  ai_prompt_custom?: string | null;
  ai_model?: string | null;
  ai_tone?: string | null;
  ai_temperature?: number | null;
  ai_coupon_code?: string | null;
  ai_delay_days?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface Order {
  id: string;
  store_id?: string | null;
  shopify_order_id: number;
  customer_id: string | null;
  address_id: string | null;
  numero_pedido: string | null;
  status_pedido: 'pendente' | 'pago' | 'separacao' | 'enviado' | 'entregue' | 'cancelado';
  valor_total: number | null;
  itens: any; // JSONB contendo snapshot dos itens
  raw_payload: any; // JSONB contendo payload completo para fins de log/audit
  created_at?: string;
  updated_at?: string;
}

export interface TrackingEvent {
  status: 'postado' | 'em_transito' | 'saiu_para_entrega' | 'entregue' | 'extraviado';
  data: string;
  descricao: string;
  local: string;
}

export interface Tracking {
  id: string;
  store_id?: string | null;
  order_id: string;
  codigo_rastreio: string;
  status: 'postado' | 'em_transito' | 'saiu_para_entrega' | 'entregue' | 'extraviado';
  historico: TrackingEvent[];
  created_at?: string;
  updated_at?: string;
}
