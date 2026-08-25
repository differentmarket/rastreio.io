import { supabaseAdmin } from './supabaseAdmin';
import { getShopifyConfig } from './shopifyService';
import { gerarCodigoRastreio } from './gerarCodigoRastreio';
import { criptografar, gerarCpfHash } from './criptografia';

function addOneBusinessDay(): Date {
  const date = new Date();
  const day = date.getDay();
  if (day === 5) date.setDate(date.getDate() + 3);
  else if (day === 6) date.setDate(date.getDate() + 2);
  else date.setDate(date.getDate() + 1);
  return date;
}

export async function executarSincronizacaoShopify(storeIdParam?: string, onlyRecent: boolean = false) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const isMock = supabaseUrl.includes('mock-project');

  // Se não passar storeIdParam, sincroniza para cada loja ativa (Multi-Tenant) + global
  let targetStores: (string | undefined)[] = [];
  if (storeIdParam) {
    targetStores = [storeIdParam];
  } else {
    const { data: stores } = await supabaseAdmin
      .from('stores')
      .select('id')
      .eq('status', 'ativa');
    if (stores && stores.length > 0) {
      targetStores = stores.map((s) => s.id);
    } else {
      targetStores = [undefined]; // Fallback global
    }
  }

  let totalSincronizados = 0;
  let totalCriados = 0;
  let totalAtualizados = 0;
  const todosResultados: any[] = [];
  const todosLogs: { tipo: 'sucesso' | 'aviso' | 'erro'; mensagem: string; data: string }[] = [];

  for (const currentStoreId of targetStores) {
    let shopifyOrders: any[] = [];

    if (isMock) {
      // Mock orders if in mock mode
      shopifyOrders = [
        {
          id: 5001,
          order_number: 5001,
          financial_status: 'paid',
          fulfillment_status: null,
          total_price: '189.90',
          created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          customer: { id: 9001, first_name: 'Ana', last_name: 'Lima', email: 'ana.lima@example.com', phone: '(11) 91234-5678' },
          shipping_address: { address1: 'Rua das Flores, 123', address2: 'Apto 4', city: 'São Paulo', province_code: 'SP', zip: '01310-100', country_code: 'BR' },
          line_items: [{ id: 1, title: 'Camiseta Premium Azul', quantity: 1, price: '189.90', sku: 'SHIRT-BLUE-M' }],
        },
      ];
    } else {
      const config = await getShopifyConfig(currentStoreId);
      if (!config.domain || !config.token) {
        todosLogs.push({
          tipo: 'aviso',
          mensagem: `Shopify não configurado para loja ${currentStoreId || 'global'}. Ignorando sync.`,
          data: new Date().toISOString(),
        });
        continue;
      }

      const cleanDomain = config.domain.replace(/^https?:\/\//, '');
      const threeDaysAgoIso = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      const dateFilter = onlyRecent ? `&updated_at_min=${threeDaysAgoIso}&limit=250` : '&limit=250';
      let nextUrl: string | null = `https://${cleanDomain}/admin/api/2024-10/orders.json?status=any&financial_status=paid,pending&order=created_at+asc${dateFilter}&fields=id,order_number,financial_status,fulfillment_status,total_price,created_at,customer,shipping_address,line_items,note_attributes`;

      try {
        while (nextUrl) {
          const res: Response = await fetch(nextUrl, {
            headers: {
              'X-Shopify-Access-Token': config.token,
              'Content-Type': 'application/json',
            },
          });

          if (!res.ok) {
            const errText = await res.text();
            todosLogs.push({
              tipo: 'erro',
              mensagem: `Erro ao conectar na Shopify (${cleanDomain}): ${errText}`,
              data: new Date().toISOString(),
            });
            break;
          }

          const data = await res.json();
          const pageOrders = data.orders || [];
          shopifyOrders.push(...pageOrders);

          if (onlyRecent) {
            nextUrl = null; // No modo otimizado do cron, faz apenas 1 página de busca
          } else {
            const linkHeader = res.headers.get('Link');
            if (linkHeader && linkHeader.includes('rel="next"')) {
              const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
              nextUrl = match ? match[1] : null;
            } else {
              nextUrl = null;
            }
          }
        }
      } catch (err: any) {
        todosLogs.push({
          tipo: 'erro',
          mensagem: `Falha na requisição HTTP para a Shopify (${cleanDomain}): ${err.message}`,
          data: new Date().toISOString(),
        });
      }
    }

    todosLogs.push({
      tipo: 'sucesso',
      mensagem: `Busca concluída na Shopify (${currentStoreId || 'global'}). Total de pedidos recebidos: ${shopifyOrders.length}`,
      data: new Date().toISOString(),
    });

    totalSincronizados += shopifyOrders.length;

    for (const shopifyOrder of shopifyOrders) {
      const shopifyOrderId = shopifyOrder.id;
      const orderNumber = String(shopifyOrder.order_number);
      const totalVal = parseFloat(shopifyOrder.total_price) || 0;
      const rawPhone = shopifyOrder.customer?.phone || (shopifyOrder.shipping_address as any)?.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '');

      try {
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
            let cpf = '';
            if (shopifyOrder.shipping_address?.company) {
              const cleanC = shopifyOrder.shipping_address.company.replace(/\D/g, '');
              if (cleanC.length === 11 || cleanC.length === 14) cpf = cleanC;
            }
            if (!cpf && shopifyOrder.note_attributes) {
              const attr = shopifyOrder.note_attributes.find((a: any) =>
                ['cpf', 'documento', 'document'].includes(a.name.toLowerCase())
              );
              if (attr?.value) cpf = attr.value.replace(/\D/g, '');
            }

            const cpfHash = cpf ? gerarCpfHash(cpf) : null;
            const cpfEnc = cpf ? criptografar(cpf) : null;

            const { data: existingCustomer } = await supabaseAdmin
              .from('customers')
              .select('id')
              .eq('shopify_customer_id', cust.id)
              .maybeSingle();

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

              const { data: newCustomer } = await supabaseAdmin
                .from('customers')
                .insert(insertData)
                .select('id')
                .single();

              if (newCustomer) {
                customerId = newCustomer.id;
              }
            }
          }
        }

        // Upsert do endereço
        let addressId: string | null = null;
        if (!isMock && customerId && shopifyOrder.shipping_address) {
          const addr = shopifyOrder.shipping_address;
          const { data: newAddr } = await supabaseAdmin
            .from('addresses')
            .insert({
              customer_id: customerId,
              logradouro: addr.address1,
              complemento: addr.address2,
              cidade: addr.city,
              estado: addr.province_code ? addr.province_code.substring(0, 2).toUpperCase() : null,
              cep: addr.zip ? addr.zip.replace(/\D/g, '') : null,
              pais: addr.country_code || 'BR',
            })
            .select('id')
            .single();

          if (newAddr) {
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
          const { data: existingOrder } = await supabaseAdmin
            .from('orders')
            .select('id')
            .eq('shopify_order_id', shopifyOrderId)
            .maybeSingle();

          if (existingOrder) {
            orderDbId = existingOrder.id;
            const { error: updErr } = await supabaseAdmin
              .from('orders')
              .update({
                status_pedido: statusPedido,
                valor_total: totalVal,
                itens: shopifyOrder.line_items,
              })
              .eq('id', orderDbId);

            if (!updErr) {
              totalAtualizados++;
              todosResultados.push({ numero_pedido: orderNumber, acao: 'atualizado', id: orderDbId! });

              // Se o pedido foi pago, atualizar recuperação de IA
              if (statusPedido === 'pago' || shopifyOrder.financial_status === 'paid') {
                const { data: conv } = await supabaseAdmin
                  .from('ai_recovery_conversations')
                  .select('id, status, mensagens')
                  .eq('order_id', orderDbId)
                  .maybeSingle();

                if (conv) {
                  if (conv.status === 'pendente_envio') {
                    await supabaseAdmin
                      .from('ai_recovery_conversations')
                      .update({ status: 'cancelado_ja_pago' })
                      .eq('id', conv.id);
                  } else if (conv.status === 'em_andamento') {
                    const msgs = Array.isArray(conv.mensagens) ? conv.mensagens : [];
                    msgs.push({
                      sender: 'system',
                      text: '🎉 Venda recuperada! Pedido pago pelo cliente.',
                      timestamp: new Date().toISOString(),
                    });
                    await supabaseAdmin
                      .from('ai_recovery_conversations')
                      .update({ status: 'convertido', mensagens: msgs })
                      .eq('id', conv.id);
                  }
                }
              }
            }
          } else {
            const createdIso = shopifyOrder.created_at || new Date().toISOString();
            const enviarNotaEm = new Date(new Date(createdIso).getTime() + 2 * 3600 * 1000).toISOString();

            const storeTargetId = currentStoreId && currentStoreId !== 'default-store' ? currentStoreId : null;

            const { data: newOrder, error: insErr } = await supabaseAdmin
              .from('orders')
              .insert({
                shopify_order_id: shopifyOrderId,
                customer_id: customerId,
                address_id: addressId,
                store_id: storeTargetId,
                numero_pedido: orderNumber,
                status_pedido: statusPedido,
                valor_total: totalVal,
                itens: shopifyOrder.line_items,
                created_at: createdIso,
                raw_payload: {
                  ...shopifyOrder,
                  enviar_nota_em: enviarNotaEm,
                  nota_enviada: false,
                },
              })
              .select('id')
              .single();

            if (!insErr && newOrder) {
              orderDbId = newOrder.id;
              isNew = true;
              totalCriados++;
              todosResultados.push({ numero_pedido: orderNumber, acao: 'criado', id: orderDbId! });

              // Agendar IA para novos pedidos pendentes
              if (statusPedido === 'pendente' && cleanPhone) {
                const customerName = shopifyOrder.customer
                  ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim()
                  : 'Cliente';

                const { data: dbSettings } = await supabaseAdmin.from('settings').select('key, value');
                const cfg: Record<string, string> = {};
                dbSettings?.forEach((s) => {
                  cfg[s.key] = s.value;
                });

                const aiDelayMinutes = parseInt(cfg['AI_DELAY_MINUTES'] || '15', 10);
                const agendadoParaRecuperacao = new Date(Date.now() + aiDelayMinutes * 60 * 1000).toISOString();

                await supabaseAdmin.from('ai_recovery_conversations').insert({
                  store_id: storeTargetId,
                  order_id: orderDbId,
                  customer_phone: cleanPhone,
                  customer_name: customerName,
                  valor_pedido: totalVal,
                  status: 'pendente_envio',
                  agendado_para: agendadoParaRecuperacao,
                  mensagens: [],
                });
              }
            }
          }
        }

        // Tracking inicial para novo pedido
        if (!isMock && isNew && orderDbId) {
          const codigo = gerarCodigoRastreio(String(shopifyOrderId));
          const syncAfter = addOneBusinessDay().toISOString();
          const storeTargetId = currentStoreId && currentStoreId !== 'default-store' ? currentStoreId : null;

          await supabaseAdmin.from('trackings').insert({
            order_id: orderDbId,
            store_id: storeTargetId,
            codigo_rastreio: codigo,
            shopify_synced: false,
            shopify_fulfilled: false,
            email_enviado: false,
            sync_after: syncAfter,
            status: 'postado',
            historico: [
              {
                status: 'postado',
                data: new Date().toISOString(),
                descricao: 'Pedido confirmado e em preparação para envio.',
                local: 'Centro de Distribuição',
              },
            ],
          });
        }
      } catch (orderLoopErr: any) {
        todosLogs.push({
          tipo: 'erro',
          mensagem: `Falha ao processar pedido #${orderNumber}: ${orderLoopErr.message}`,
          data: new Date().toISOString(),
        });
      }
    }
  }

  return {
    sincronizados: totalSincronizados,
    criados: totalCriados,
    atualizados: totalAtualizados,
    resultados: todosResultados,
    logs: todosLogs,
  };
}
