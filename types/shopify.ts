export interface ShopifyCustomer {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  tags: string | null;
}

export interface ShopifyAddress {
  address1: string | null;
  address2: string | null;
  city: string | null;
  province_code: string | null; // e.g. 'SP'
  zip: string | null;
  country_code: string | null; // e.g. 'BR'
  company: string | null;
}

export interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  price: string;
  sku: string | null;
}

export interface ShopifyNoteAttribute {
  name: string;
  value: string;
}

export interface ShopifyOrderWebhook {
  id: number;
  order_number: number;
  total_price: string;
  customer?: ShopifyCustomer;
  shipping_address?: ShopifyAddress;
  billing_address?: ShopifyAddress;
  line_items: ShopifyLineItem[];
  note_attributes?: ShopifyNoteAttribute[];
  financial_status?: string;
  fulfillment_status?: string;
}
