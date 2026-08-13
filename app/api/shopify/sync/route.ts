import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';
import { getShopifyConfig } from '@/lib/shopifyService';
import { gerarCodigoRastreio } from '@/lib/gerarCodigoRastreio';

export const dynamic = 'force-dynamic';

function addOneBusinessDay(): Date {
  const date = new Date();
  const day = date.getDay();
  if (day === 5) date.setDate(date.getDate() + 3);
  else if (day === 6) date.setDate(date.getDate() + 2);
  else date.setDate(date.getDate() + 1);
  return date;
}

// Dados mock simulando pedidos vindos da Shopify
function getMockShopifyOrders() {
  const now = Date.now();
  return [
    {
      id: 5001,
      order_number: 5001,
      financial_status: 'paid',
      fulfillment_status: null,
      total_price: '189.90',
      created_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
      customer: { id: 9001, first_name: 'Ana', last_name: 'Lima', email: 'ana.lima@example.com', phone: '(11) 91234-5678' },
      shipping_address: { address1: 'Rua das Flores, 123', address2: 'Apto 4', city: 'São Paulo', province_code: 'SP', zip: '01310-100', country_code: 'BR' },
      line_items: [{ id: 1, title: 'Camiseta Premium Azul', quantity: 1, price: '189.90', sku: 'SHIRT-BLUE-M' }],
    },
    {
      id: 5002,
      order_number: 5002,
      financial_status: 'paid',
      fulfillment_status: null,
      total_price: '340.00',
      created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      customer: { id: 9002, first_name: 'Bruno', last_name: 'Carvalho', email: 'bruno.carvalho@example.com', phone: '(21) 98765-4321' },
      shipping_address: { address1: 'Av. Rio Branco, 500', address2: '', city: 'Rio de Janeiro', province_code: 'RJ', zip: '20040-020', country_code: 'BR' },
      line_items: [
        { id: 2, title: 'Calça Jogger Preta', quantity: 1, price: '220.00', sku: 'JOGGER-BLK-G' },
        { id: 3, title: 'Meias Esportivas Pack 3x', quantity: 2, price: '60.00', sku: 'SOCKS-SPT-3PK' },
      ],
    },
    {
      id: 5003,
      order_number: 5003,
      financial_status: 'paid',
      fulfillment_status: null,
      total_price: '95.00',
      created_at: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
      customer: { id: 9003, first_name: 'Carla', last_name: 'Mendes', email: 'carla.mendes@example.com', phone: '(31) 97654-3210' },
      shipping_address: { address1: 'Rua Goitacazes, 75', address2: 'Sala 12', city: 'Belo Horizonte', province_code: 'MG', zip: '30190-050', country_code: 'BR' },
      line_items: [{ id: 4, title: 'Boné Snapback Logo', quantity: 1, price: '95.00', sku: 'CAP-SNAP-UN' }],
    },
    {
      id: 5004,
      order_number: 5004,
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      total_price: '560.00',
      created_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
      customer: { id: 9004, first_name: 'Diego', last_name: 'Fonseca', email: 'diego.fonseca@example.com', phone: '(41) 96543-2109' },
      shipping_address: { address1: 'Rua XV de Novembro, 1200', address2: '', city: 'Curitiba', province_code: 'PR', zip: '80020-310', country_code: 'BR' },
      line_items: [{ id: 5, title: 'Kit Treino Completo', quantity: 2, price: '280.00', sku: 'KIT-TRAIN-M' }],
    },
    {
      id: 5005,
      order_number: 5005,
      financial_status: 'pending',
      fulfillment_status: null,
      total_price: '210.50',
      created_at: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
      customer: { id: 9005, first_name: 'Elisa', last_name: 'Rocha', email: 'elisa.rocha@example.com', phone: '(51) 95432-1098' },
      shipping_address: { address1: 'Av. Ipiranga, 6681', address2: 'Bloco B', city: 'Porto Alegre', province_code: 'RS', zip: '90619-900', country_code: 'BR' },
      line_items: [{ id: 6, title: 'Moletom Oversized Branco', quantity: 1, price: '210.50', sku: 'HOODIE-OVR-W' }],
    },
  ];
}

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const isMock = supabaseUrl.includes('mock-project');

    let shopifyOrders: any[] = [];

    if (isMock) {
      shopifyOrders = getMockShopifyOrders();
    } else {
      // Produção: buscar TODOS os pedidos da Shopify com paginação
      const config = await getShopifyConfig();
      if (!config.domain || !config.token) {
        return NextResponse.json({ error: 'Shopify não configurado. Configure o domínio e token na aba de configurações.' }, { status: 422 });
      }

      const cleanDomain = config.domain.replace(/^https?:\/\//, '');
      let nextUrl: string | null = `https://${cleanDomain}/admin/api/2024-10/orders.json?status=any&financial_status=paid&limit=250&fields=id,order_number,financial_status,fulfillment_status,total_price,created_at,customer,shipping_address,line_items`;

      while (nextUrl) {
        const res: Response = await fetch(nextUrl, {
          headers: {
            'X-Shopify-Access-Token': config.token,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error('Erro ao buscar pedidos da Shopify:', errText);
          return NextResponse.json({ error: 'Falha ao conectar com a Shopify. Verifique o token e domínio.' }, { status: 502 });
        }

        const data = await res.json();
        const pageOrders = data.orders || [];
        shopifyOrders.push(...pageOrders);

        // Verifica cabeçalho Link para proxima página da Shopify
        const linkHeader = res.headers.get('Link');
        if (linkHeader && linkHeader.includes('rel="next"')) {
          const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          nextUrl = match ? match[1] : null;
        } else {
          nextUrl = null;
        }
      }
    }

    const resultados: { numero_pedido: string; acao: 'criado' | 'atualizado'; id: string }[] = [];
    const logs: { tipo: 'sucesso' | 'aviso' | 'erro'; mensagem: string; data: string }[] = [];

    logs.push({ tipo: 'sucesso', mensagem: `Busca concluída na Shopify. Total de pedidos recebidos: ${shopifyOrders.length}`, data: new Date().toISOString() });

    for (const shopifyOrder of shopifyOrders) {
      const shopifyOrderId = shopifyOrder.id;
      const orderNumber = String(shopifyOrder.order_number);
      const totalVal = parseFloat(shopifyOrder.total_price) || 0;

      try {
        // Status interno
        let statusPedido = 'pendente';
        if (shopifyOrder.financial_status === 'paid') statusPedido = 'pago';
        if (shopifyOrder.fulfillment_status === 'fulfilled') statusPedido = 'enviado';

        // Upsert do cliente
        let customerId: string | null = null;
        if (shopifyOrder.customer) {
          const cust = shopifyOrder.customer;
          const customerName = `${cust.first_name || ''} ${cust.last_name || ''}`.trim() || 'Cliente Shopify';

          if (isMock) {
            customerId = `mock-cust-${cust.id}`;
          } else {
            // Extrair CPF (shipping_address.company, note_attributes ou tags)
            let cpf = '';
            if (shopifyOrder.shipping_address?.company) {
              const cleanC = shopifyOrder.shipping_address.company.replace(/\D/g, '');
              if (cleanC.length === 11 || cleanC.length === 14) cpf = cleanC;
            }
            if (!cpf && shopifyOrder.note_attributes) {
              const attr = shopifyOrder.note_attributes.find((a: any) => ['cpf', 'documento', 'document'].includes(a.name.toLowerCase()));
              if (attr?.value) cpf = attr.value.replace(/\D/g, '');
            }

            const { criptografar, gerarCpfHash } = require('@/lib/criptografia');
            const cpfHash = cpf ? gerarCpfHash(cpf) : null;
            const cpfEnc = cpf ? criptografar(cpf) : null;

            const { data: existingCustomer, error: custFetchErr } = await supabaseAdmin
              .from('customers')
              .select('id')
              .eq('shopify_customer_id', cust.id)
              .maybeSingle();

            if (custFetchErr) {
              logs.push({ tipo: 'aviso', mensagem: `Aviso ao consultar cliente para o pedido #${orderNumber}: ${custFetchErr.message}`, data: new Date().toISOString() });
            }

            if (existingCustomer) {
              customerId = existingCustomer.id;
              const updateData: any = {
                nome: customerName,
                email: cust.email,
                telefone: cust.phone,
              };
              if (cpfEnc) updateData.cpf_encrypted = `\\x${cpfEnc.toString('hex')}`;
              if (cpfHash) updateData.cpf_hash = cpfHash;

              await supabaseAdmin.from('customers').update(updateData).eq('id', customerId);
            } else {
              const insertData: any = {
                shopify_customer_id: cust.id,
                nome: customerName,
                email: cust.email,
                telefone: cust.phone,
              };
              if (cpfEnc) insertData.cpf_encrypted = `\\x${cpfEnc.toString('hex')}`;
              if (cpfHash) insertData.cpf_hash = cpfHash;

              const { data: newCustomer, error: custInsErr } = await supabaseAdmin.from('customers').insert(insertData).select('id').single();
              
              if (custInsErr) {
                logs.push({ tipo: 'erro', mensagem: `Erro ao criar cliente para o pedido #${orderNumber}: ${custInsErr.message}`, data: new Date().toISOString() });
              } else if (newCustomer) {
                customerId = newCustomer.id;
              }
            }
          }
        }

        // Upsert do endereço
        let addressId: string | null = null;
        if (!isMock && customerId && shopifyOrder.shipping_address) {
          const addr = shopifyOrder.shipping_address;
          const { data: newAddr, error: addrErr } = await supabaseAdmin.from('addresses').insert({
            customer_id: customerId,
            logradouro: addr.address1,
            complemento: addr.address2,
            cidade: addr.city,
            estado: addr.province_code ? addr.province_code.substring(0, 2).toUpperCase() : null,
            cep: addr.zip ? addr.zip.replace(/\D/g, '') : null,
            pais: addr.country_code || 'BR',
          }).select('id').single();

          if (addrErr) {
            logs.push({ tipo: 'aviso', mensagem: `Erro ao salvar endereço para o pedido #${orderNumber}: ${addrErr.message}`, data: new Date().toISOString() });
          } else if (newAddr) {
            addressId = newAddr.id;
          }
        }

        // Upsert do pedido
        let orderDbId: string | null = null;
        let isNew = false;

        if (isMock) {
          orderDbId = `mock-shopify-${shopifyOrderId}`;
          isNew = true;
        } else {
          const { data: existingOrder, error: orderCheckErr } = await supabaseAdmin
            .from('orders')
            .select('id')
            .eq('shopify_order_id', shopifyOrderId)
            .maybeSingle();

          if (orderCheckErr) {
            logs.push({ tipo: 'erro', mensagem: `Erro ao verificar existência do pedido #${orderNumber}: ${orderCheckErr.message}`, data: new Date().toISOString() });
          }

          if (existingOrder) {
            orderDbId = existingOrder.id;
            const { error: updErr } = await supabaseAdmin.from('orders').update({
              status_pedido: statusPedido,
              valor_total: totalVal,
              itens: shopifyOrder.line_items,
            }).eq('id', orderDbId);

            if (updErr) {
              logs.push({ tipo: 'erro', mensagem: `Erro ao atualizar pedido #${orderNumber} no Supabase: ${updErr.message}`, data: new Date().toISOString() });
            } else {
              resultados.push({ numero_pedido: orderNumber, acao: 'atualizado', id: orderDbId! });
              logs.push({ tipo: 'sucesso', mensagem: `Pedido #${orderNumber} atualizado com sucesso.`, data: new Date().toISOString() });
            }
          } else {
            const { data: newOrder, error: insErr } = await supabaseAdmin.from('orders').insert({
              shopify_order_id: shopifyOrderId,
              customer_id: customerId,
              address_id: addressId,
              numero_pedido: orderNumber,
              status_pedido: statusPedido,
              valor_total: totalVal,
              itens: shopifyOrder.line_items,
              created_at: shopifyOrder.created_at || new Date().toISOString(),
            }).select('id').single();

            if (insErr) {
              logs.push({ tipo: 'erro', mensagem: `Erro ao gravar pedido #${orderNumber} no Supabase: ${insErr.message}`, data: new Date().toISOString() });
            } else if (newOrder) {
              orderDbId = newOrder.id;
              isNew = true;
              resultados.push({ numero_pedido: orderNumber, acao: 'criado', id: orderDbId! });
              logs.push({ tipo: 'sucesso', mensagem: `Pedido #${orderNumber} criado e salvo no banco.`, data: new Date().toISOString() });
            }
          }
        }

        // Criar tracking se pedido novo (produção)
        if (!isMock && isNew && orderDbId) {
          const codigo = gerarCodigoRastreio(String(shopifyOrderId));
          const syncAfter = addOneBusinessDay().toISOString();
          const { error: trkErr } = await supabaseAdmin.from('trackings').insert({
            order_id: orderDbId,
            codigo_rastreio: codigo,
            shopify_synced: false,
            shopify_fulfilled: false,
            email_enviado: false,
            sync_after: syncAfter,
            status: 'postado',
            historico: [{
              status: 'postado',
              data: new Date().toISOString(),
              descricao: 'Pedido confirmado e em preparação para envio.',
              local: 'Centro de Distribuição',
            }],
          });

          if (trkErr) {
            logs.push({ tipo: 'aviso', mensagem: `Erro ao criar rastreamento para #${orderNumber}: ${trkErr.message}`, data: new Date().toISOString() });
          }
        }
      } catch (orderLoopErr: any) {
        logs.push({ tipo: 'erro', mensagem: `Falha crítica ao processar pedido #${orderNumber}: ${orderLoopErr.message}`, data: new Date().toISOString() });
      }
    }

    return NextResponse.json({
      success: true,
      sincronizados: shopifyOrders.length,
      criados: resultados.filter(r => r.acao === 'criado').length,
      atualizados: resultados.filter(r => r.acao === 'atualizado').length,
      resultados,
      logs,
      mockOrders: isMock ? shopifyOrders.map((o) => ({
        id: `mock-shopify-${o.id}`,
        shopify_order_id: o.id,
        numero_pedido: String(o.order_number),
        status_pedido: o.fulfillment_status === 'fulfilled' ? 'enviado' : o.financial_status === 'paid' ? 'pago' : 'pendente',
        valor_total: parseFloat(o.total_price),
        created_at: o.created_at,
        shopify_fulfillment_status: o.fulfillment_status,
        customers: {
          id: `mock-cust-${o.customer?.id}`,
          nome: `${o.customer?.first_name} ${o.customer?.last_name}`.trim(),
          email: o.customer?.email,
          telefone: o.customer?.phone,
        },
        addresses: o.shipping_address ? {
          logradouro: o.shipping_address.address1,
          complemento: o.shipping_address.address2,
          cidade: o.shipping_address.city,
          estado: o.shipping_address.province_code?.substring(0, 2),
          cep: o.shipping_address.zip,
        } : null,
        itens: o.line_items,
        trackings: {
          codigo_rastreio: `BR${String(o.id).padStart(8, '0')}SP`,
          status: o.fulfillment_status === 'fulfilled' ? 'entregue' : 'postado',
          email_enviado: o.fulfillment_status === 'fulfilled',
          email_enviado_em: o.fulfillment_status === 'fulfilled' ? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() : null,
          shopify_synced: o.fulfillment_status === 'fulfilled',
          historico: [
            { status: 'postado', data: o.created_at, descricao: 'Pedido confirmado e em preparação para envio.', local: 'Centro de Distribuição' },
          ],
        },
      })) : undefined,
    });
  } catch (err: any) {
    console.error('Erro na sincronização com Shopify:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
