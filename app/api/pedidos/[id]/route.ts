import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';
import { descriptografar } from '@/lib/criptografia';

export const dynamic = 'force-dynamic';

function parseBytea(val: any): Buffer | null {
  if (!val) return null;
  if (Buffer.isBuffer(val)) return val;
  if (val instanceof Uint8Array) return Buffer.from(val);
  if (typeof val === 'string') {
    let hex = val;
    if (hex.startsWith('\\x')) {
      hex = hex.substring(2);
    }
    return Buffer.from(hex, 'hex');
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    // Bypass com dados mockados para detalhes do pedido
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl.includes('mock-project')) {
      const mockDetails: Record<string, any> = {
        "mock-order-1": {
          id: "mock-order-1",
          shopify_order_id: 1001,
          numero_pedido: "1001",
          status_pedido: "entregue",
          valor_total: 250.00,
          created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          itens: [
            { id: 1, title: "Camiseta Oficial Shopify Black", quantity: 1, price: "150.00", sku: "SHIRT-BLK-L" },
            { id: 2, title: "Caneca de Cerâmica Shopify Green", quantity: 2, price: "50.00", sku: "MUG-GRN" }
          ],
          customers: { id: "cust-1", nome: "Carlos Silva", email: "carlos.silva@example.com", telefone: "(11) 98888-7777", cpf: "123.456.789-00" },
          addresses: { logradouro: "Av. Paulista", numero: "1000", complemento: "Apto 12", bairro: "Bela Vista", cidade: "São Paulo", estado: "SP", cep: "01310-100", pais: "BR" },
          trackings: {
            codigo_rastreio: "BR2607X8F3K9",
            status: "entregue",
            historico: [
              { status: "postado", data: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto postado pela loja", local: "Central de Logística, São Paulo - SP" },
              { status: "em_transito", data: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto encaminhado para Unidade de Tratamento", local: "Unidade de Tratamento, Curitiba - PR" },
              { status: "saiu_para_entrega", data: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto saiu para entrega ao destinatário", local: "CDD Centro, Curitiba - PR" },
              { status: "entregue", data: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000).toISOString(), descricao: "Objeto entregue ao destinatário", local: "Curitiba - PR" }
            ]
          }
        },
        "mock-order-2": {
          id: "mock-order-2",
          shopify_order_id: 1002,
          numero_pedido: "1002",
          status_pedido: "pago",
          valor_total: 120.50,
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          itens: [
            { id: 3, title: "Chaveiro Emborrachado Shopify Logo", quantity: 5, price: "24.10", sku: "KEY-LOGO" }
          ],
          customers: { id: "cust-2", nome: "Maria Souza", email: "maria.souza@example.com", telefone: "(21) 97777-6666", cpf: "987.654.321-11" },
          addresses: { logradouro: "Rua das Laranjeiras", numero: "500", complemento: "", bairro: "Laranjeiras", cidade: "Rio de Janeiro", estado: "RJ", cep: "22240-000", pais: "BR" },
          trackings: {
            codigo_rastreio: "BR2607A3F9K1",
            status: "em_transito",
            historico: [
              { status: "postado", data: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto postado pela loja", local: "Central de Logística, São Paulo - SP" },
              { status: "em_transito", data: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto em trânsito para Unidade de Distribuição", local: "CTE Benfica, Rio de Janeiro - RJ" }
            ]
          }
        },
        "mock-order-3": {
          id: "mock-order-3",
          shopify_order_id: 1003,
          numero_pedido: "1003",
          status_pedido: "pendente",
          valor_total: 450.00,
          created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
          itens: [
            { id: 4, title: "Moletom Canguru Premium", quantity: 1, price: "450.00", sku: "HOODIE-PREM-XL" }
          ],
          customers: { id: "cust-3", nome: "João Pereira", email: "joao.pereira@example.com", telefone: "(31) 96666-5555", cpf: "111.222.333-44" },
          addresses: { logradouro: "Av. Afonso Pena", numero: "2000", complemento: "Sala 301", bairro: "Centro", cidade: "Belo Horizonte", estado: "MG", cep: "30130-005", pais: "BR" },
          trackings: {
            codigo_rastreio: "BR2607T4Y7P2",
            status: "postado",
            historico: [
              { status: "postado", data: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), descricao: "Objeto postado pela loja", local: "Central de Logística, São Paulo - SP" }
            ]
          }
        }
      };

      const orderDetail = mockDetails[id];
      if (orderDetail) {
        return NextResponse.json(orderDetail);
      }
      return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    }

    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        shopify_order_id,
        numero_pedido,
        status_pedido,
        valor_total,
        itens,
        created_at,
        customers (
          id,
          nome,
          email,
          telefone,
          cpf_encrypted
        ),
        addresses (
          logradouro,
          numero,
          complemento,
          bairro,
          cidade,
          estado,
          cep,
          pais
        ),
        trackings (
          codigo_rastreio,
          status,
          historico
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar detalhe do pedido:', error);
      return NextResponse.json(
        { error: 'Falha ao buscar detalhes do pedido.' },
        { status: 500 }
      );
    }

    if (!order) {
      return NextResponse.json(
        { error: 'Pedido não encontrado.' },
        { status: 404 }
      );
    }

    // Descriptografa o CPF se estiver presente
    let cpf = '';
    const customer: any = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    if (customer && customer.cpf_encrypted) {
      const buffer = parseBytea(customer.cpf_encrypted);
      if (buffer) {
        cpf = descriptografar(buffer);
      }
    }

    const responseData = {
      ...order,
      customers: customer ? {
        ...customer,
        cpf,
        // Remova o campo criptografado original da resposta para segurança
        cpf_encrypted: undefined,
      } : null,
    };

    return NextResponse.json(responseData);
  } catch (err: any) {
    console.error('Erro na rota de detalhe de pedido:', err);
    return NextResponse.json(
      { error: err.message || 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}
