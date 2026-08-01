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

export interface Order {
  id: string;
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
  order_id: string;
  codigo_rastreio: string;
  status: 'postado' | 'em_transito' | 'saiu_para_entrega' | 'entregue' | 'extraviado';
  historico: TrackingEvent[];
  created_at?: string;
  updated_at?: string;
}
