import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyWebhook } from '@/lib/verifyShopifyWebhook';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { gerarCodigoRastreio } from '@/lib/gerarCodigoRastreio';
import { criptografar, gerarCpfHash } from '@/lib/criptografia';
import { ShopifyOrderWebhook } from '@/types/shopify';
import { getShopifyConfig, enviarRastreioShopify } from '@/lib/shopifyService';
import { enqueueJourney } from '@/lib/trackingJourney';

// Desabilita body parsing automático do Next.js para lermos o raw text para validação do HMAC
export const dynamic = 'force-dynamic';

function addOneBusinessDay(): Date {
  const date = new Date();
  const day = date.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  
  if (day === 5) { // Sexta-feira -> Pula para Segunda
    date.setDate(date.getDate() + 3);
  } else if (day === 6) { // Sábado -> Pula para Segunda
    date.setDate(date.getDate() + 2);
  } else { // Outros dias -> Adiciona 1 dia
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function extrairCpf(payload: ShopifyOrderWebhook): string {
  // 1. Procurar em shipping_address.company (Padrão de checkouts no Brasil como Zedy, Yampi, CartPanda)
  if (payload.shipping_address?.company) {
    const cleanCompany = payload.shipping_address.company.replace(/\D/g, '');
    if (cleanCompany.length === 11 || cleanCompany.length === 14) {
      return cleanCompany;
    }
  }

  // 2. Procurar em billing_address.company
  if (payload.billing_address?.company) {
    const cleanCompany = payload.billing_address.company.replace(/\D/g, '');
    if (cleanCompany.length === 11 || cleanCompany.length === 14) {
      return cleanCompany;
    }
  }

  // 3. Procurar em note_attributes
  if (payload.note_attributes) {
    const cpfAttribute = payload.note_attributes.find(
      (attr) =>
        attr.name.toLowerCase() === 'cpf' ||
        attr.name.toLowerCase() === 'documento' ||
        attr.name.toLowerCase() === 'document' ||
        attr.name.toLowerCase() === 'cadastro'
    );
    if (cpfAttribute && cpfAttribute.value) {
      return cpfAttribute.value.replace(/\D/g, '');
    }
  }

  // 4. Procurar em customer.tags
  if (payload.customer && payload.customer.tags) {
    const tags = payload.customer.tags.split(',').map((t) => t.trim());
    for (const tag of tags) {
      if (tag.toLowerCase().startsWith('cpf:')) {
        return tag.substring(4).replace(/\D/g, '');
      }
      const numbersOnly = tag.replace(/\D/g, '');
      if (numbersOnly.length === 11 || numbersOnly.length === 14) {
        return numbersOnly;
      }
    }
  }

  return '';
}

export async function GET() {
  return NextResponse.json({ ok: true, status: 'online', service: 'Rastreio.IO Shopify Webhook' });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    // 1. Capturar raw body para validação criptográfica HMAC
    const rawBody = await req.text();
    const topic = req.headers.get('x-shopify-topic');
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256') || '';
    const shopDomainHeader = req.headers.get('x-shopify-shop-domain') || '';

    // Validação preliminar de cabeçalhos Shopify
    if (!shopDomainHeader || !hmacHeader) {
      return NextResponse.json(
        { error: 'Cabeçalhos do webhook Shopify (x-shopify-shop-domain / x-shopify-hmac-sha256) ausentes.' },
        { status: 401 }
      );
    }

    const cleanDomain = shopDomainHeader.toLowerCase().trim().replace(/^https?:\/\//, '');

    // 2. Identificar loja cadastrada internamente (NUNCA confiar no payload)
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('id, status, shopify_domain, shopify_webhook_secret')
      .ilike('shopify_domain', cleanDomain)
      .maybeSingle();

    let resolvedStore = store;
    if (!resolvedStore) {
      const { data: allStores } = await supabaseAdmin
        .from('stores')
        .select('id, status, shopify_domain, shopify_webhook_secret');
      resolvedStore = (allStores || []).find((s: any) => {
        const d = (s.shopify_domain || '').toLowerCase().trim().replace(/^https?:\/\//, '');
        return d === cleanDomain || cleanDomain.startsWith(d);
      }) || null;
    }

    let storeId: string | null = null;
    let webhookSecret = '';

    if (resolvedStore) {
      // Validar status da loja
      if (resolvedStore.status && resolvedStore.status !== 'ativa') {
        return NextResponse.json(
          { error: 'Loja inativa. Webhook rejeitado.' },
          { status: 403 }
        );
      }
      storeId = resolvedStore.id;
      webhookSecret = resolvedStore.shopify_webhook_secret || '';
    } else {
      // Verificar se corresponde à loja global configurada em settings
      const { data: dbSettings } = await supabaseAdmin.from('settings').select('key, value');
      const cfg: Record<string, string> = {};
      dbSettings?.forEach(s => { cfg[s.key] = s.value; });
      const globalDomain = (cfg['SHOPIFY_STORE_DOMAIN'] || process.env.SHOPIFY_STORE_DOMAIN || '')
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//, '');

      if (globalDomain && (globalDomain === cleanDomain || cleanDomain.startsWith(globalDomain))) {
        webhookSecret = cfg['SHOPIFY_WEBHOOK_SECRET'] || process.env.SHOPIFY_WEBHOOK_SECRET || '';
        storeId = null;
      } else {
        return NextResponse.json(
          { error: 'Loja não encontrada ou não cadastrada para este domínio Shopify.' },
          { status: 401 }
        );
      }
    }

    // Se a loja não tem segredo cadastrado, tenta o segredo global de fallback
    if (!webhookSecret) {
      const { data: dbSettings } = await supabaseAdmin.from('settings').select('key, value');
      const cfg: Record<string, string> = {};
      dbSettings?.forEach(s => { cfg[s.key] = s.value; });
      webhookSecret = cfg['SHOPIFY_WEBHOOK_SECRET'] || process.env.SHOPIFY_WEBHOOK_SECRET || '';
    }

    // 3. Validar assinatura HMAC usando o segredo específico da loja
    const isSignatureValid = verifyShopifyWebhook(rawBody, hmacHeader, webhookSecret);
    if (!isSignatureValid) {
      console.warn(`[WEBHOOK SHOPIFY] Assinatura HMAC inválida para domínio: ${cleanDomain}`);
      return NextResponse.json(
        { error: 'Assinatura HMAC inválida.' },
        { status: 401 }
      );
    }

    // 4. Somente após a validação criptográfica, processar o payload JSON
    let payload: ShopifyOrderWebhook;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ ok: true, message: 'Ping recebido com sucesso.' });
    }

    if (topic === 'orders/create' || topic === 'orders/updated') {
      const shopifyOrderId = payload.id;
      const orderNumber = String(payload.order_number);
      const totalVal = parseFloat(payload.total_price) || 0;

      // 1. Mapeamento do Cliente
      let customerId: string | null = null;
      if (payload.customer) {
        const cpf = extrairCpf(payload);
        const cpfHash = cpf ? gerarCpfHash(cpf) : null;
        const cpfEnc = cpf ? criptografar(cpf) : null;
        
        const customerName = `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim() || 'Cliente Shopify';
        
        // Verifica se o cliente já existe por shopify_customer_id ou cpf_hash
        let existingCustomer = null;
        
        if (payload.customer.id) {
          const { data } = await supabaseAdmin
            .from('customers')
            .select('id')
            .eq('shopify_customer_id', payload.customer.id)
            .maybeSingle();
          existingCustomer = data;
        }

        if (!existingCustomer && cpfHash) {
          const { data } = await supabaseAdmin
            .from('customers')
            .select('id')
            .eq('cpf_hash', cpfHash)
            .maybeSingle();
          existingCustomer = data;
        }

        if (existingCustomer) {
          customerId = existingCustomer.id;
          // Atualiza dados básicos
          await supabaseAdmin
            .from('customers')
            .update({
              nome: customerName,
              email: payload.customer.email,
              telefone: payload.customer.phone,
              ...(cpfEnc && { cpf_encrypted: cpfEnc.toString('hex') }),
              ...(cpfHash && { cpf_hash: cpfHash }),
            })
            .eq('id', customerId);
        } else {
          // Cria novo cliente
          const { data, error } = await supabaseAdmin
            .from('customers')
            .insert({
              shopify_customer_id: payload.customer.id,
              nome: customerName,
              email: payload.customer.email,
              telefone: payload.customer.phone,
              // Convertemos Buffer de criptografia para hex string para armazenar no Postgres bytea
              cpf_encrypted: cpfEnc ? `\\x${cpfEnc.toString('hex')}` : null,
              cpf_hash: cpfHash,
            })
            .select('id')
            .single();

          if (error) {
            console.error('Erro ao criar cliente:', error);
          } else {
            customerId = data.id;
          }
        }
      }

      // 2. Mapeamento do Endereço
      let addressId: string | null = null;
      if (customerId && payload.shipping_address) {
        const addr = payload.shipping_address;
        
        // Insere o endereço de entrega do pedido
        const { data, error } = await supabaseAdmin
          .from('addresses')
          .insert({
            customer_id: customerId,
            logradouro: addr.address1,
            numero: addr.company || '', // costuma ir em company ou no final do address1
            complemento: addr.address2,
            bairro: '', // Shopify API não tem bairro nativo de forma direta fora do address2/city dependendo da integração
            cidade: addr.city,
            estado: addr.province_code ? addr.province_code.substring(0, 2).toUpperCase() : null,
            cep: addr.zip ? addr.zip.replace(/\D/g, '') : null,
            pais: addr.country_code || 'BR',
          })
          .select('id')
          .single();

        if (error) {
          console.error('Erro ao criar endereço:', error);
        } else {
          addressId = data.id;
        }
      }

      // Mapeamento do status interno
      let statusPedido = 'pendente';
      if (payload.financial_status === 'paid') {
        statusPedido = 'pago';
      }
      if (payload.fulfillment_status === 'fulfilled') {
        statusPedido = 'enviado';
      }

      // Busca configuração de delay para envio da Nota Fiscal e Agendamento de Recuperação
      const { data: dbSettings } = await supabaseAdmin.from('settings').select('key, value');
      const cfg: Record<string, string> = {};
      dbSettings?.forEach(s => { cfg[s.key] = s.value; });
      const notaDelayHoras = parseInt(cfg['NOTA_DELAY_HORAS'] || '2', 10);
      const enviarNotaEm = new Date(Date.now() + notaDelayHoras * 3600 * 1000).toISOString();

      let recoveryDelayMinutes = 30;
      if (storeId) {
        const { data: step1 } = await supabaseAdmin
          .from('recovery_steps')
          .select('delay_minutes')
          .eq('store_id', storeId)
          .eq('step_number', 1)
          .eq('is_active', true)
          .maybeSingle();

        if (step1?.delay_minutes) {
          recoveryDelayMinutes = Number(step1.delay_minutes);
        } else {
          const { data: storeRec } = await supabaseAdmin
            .from('stores')
            .select('ai_recovery_delay_minutes')
            .eq('id', storeId)
            .maybeSingle();
          if (storeRec?.ai_recovery_delay_minutes) {
            recoveryDelayMinutes = Number(storeRec.ai_recovery_delay_minutes);
          }
        }
      }
      const agendadoParaRecuperacao = new Date(Date.now() + recoveryDelayMinutes * 60 * 1000).toISOString();

      // Extrair telefone do cliente para WhatsApp
      const rawPhone = payload.customer?.phone || (payload.shipping_address as any)?.phone || (payload.billing_address as any)?.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '');

      // 3. Upsert do Pedido
      let orderDbId: string | null = null;
      const { data: existingOrder } = await supabaseAdmin
        .from('orders')
        .select('id, store_id, status_pedido')
        .eq('shopify_order_id', shopifyOrderId)
        .maybeSingle();

      if (existingOrder) {
        // Garantir que webhook recebido da Loja A nunca altere pedido pertencente à Loja B
        if (storeId && existingOrder.store_id && existingOrder.store_id !== storeId) {
          console.warn(`[WEBHOOK SHOPIFY] Conflito de tenant: webhook da loja ${storeId} tentou atualizar pedido pertencente à loja ${existingOrder.store_id}`);
          return NextResponse.json({ error: 'Conflito de tenant detectado.' }, { status: 403 });
        }

        orderDbId = existingOrder.id;
        await supabaseAdmin
          .from('orders')
          .update({
            status_pedido: statusPedido,
            valor_total: totalVal,
            itens: payload.line_items,
            raw_payload: payload,
          })
          .eq('id', orderDbId);

        // Se o pedido foi atualizado para PAGO, verificar se houve mensagem enviada para atribuir receita
        if (statusPedido === 'pago' || payload.financial_status === 'paid') {
          // 1. Verifica se houve mensagem enviada previamente pela recuperação
          const { data: sentQueueItem } = await supabaseAdmin
            .from('recovery_queue')
            .select('id, store_id, customer_id, sent_at, last_sent_step, current_step')
            .eq('order_id', orderDbId)
            .maybeSingle();

          const stepUsed = (sentQueueItem?.last_sent_step && sentQueueItem.last_sent_step > 0)
            ? sentQueueItem.last_sent_step
            : (sentQueueItem?.sent_at ? 1 : 0);

          if (sentQueueItem && stepUsed > 0 && sentQueueItem.sent_at) {
            const sentAtMs = new Date(sentQueueItem.sent_at).getTime();
            const diffMin = Math.max(0, Math.round((Date.now() - sentAtMs) / (60 * 1000)));

            // Atribuição de receita à recuperação com identificação do step que converteu
            await supabaseAdmin.from('recovery_revenue').upsert({
              store_id: sentQueueItem.store_id || storeId,
              order_id: orderDbId,
              queue_id: sentQueueItem.id,
              customer_id: sentQueueItem.customer_id,
              valor_total: totalVal,
              attribution_type: 'whatsapp_recovery',
              step_number: stepUsed,
              tempo_minutos_ate_conversao: diffMin,
              sent_at: sentQueueItem.sent_at,
              recovered_at: new Date().toISOString(),
            }, { onConflict: 'order_id' });

            // Registro do evento de conversão por etapa
            await supabaseAdmin.from('recovery_events').insert({
              store_id: sentQueueItem.store_id || storeId,
              order_id: orderDbId,
              queue_id: sentQueueItem.id,
              event_type: 'step_converted',
              channel: 'whatsapp',
              metadata: { valor_total: totalVal, tempo_minutos: diffMin, step_number: stepUsed },
            });
          }

          // 2. Cancela qualquer recuperação pendente e passos futuros que ainda não foram disparados
          await supabaseAdmin
            .from('recovery_queue')
            .update({
              status: 'cancelled',
              cancelled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              next_action_at: null,
            })
            .eq('order_id', orderDbId)
            .in('status', ['pending', 'processing']);

          await supabaseAdmin.from('recovery_events').insert({
            store_id: sentQueueItem?.store_id || storeId,
            order_id: orderDbId,
            event_type: 'step_cancelled',
            channel: 'whatsapp',
            metadata: { reason: 'order_paid' },
          });

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
      } else {
        const { data: newOrder, error } = await supabaseAdmin
          .from('orders')
          .insert({
            store_id: storeId,
            shopify_order_id: shopifyOrderId,
            customer_id: customerId,
            address_id: addressId,
            numero_pedido: orderNumber,
            status_pedido: statusPedido,
            valor_total: totalVal,
            itens: payload.line_items,
            raw_payload: {
              ...payload,
              enviar_nota_em: enviarNotaEm,
              nota_enviada: false,
            },
          })
          .select('id')
          .single();

        if (error) {
          console.error('Erro ao criar pedido:', error);
        } else {
          orderDbId = newOrder.id;

          // Se for um novo pedido e estiver PENDENTE (não pago), agendar na fila de recuperação recovery_queue
          if (statusPedido === 'pendente' && cleanPhone) {
            const customerName = payload.customer
              ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim()
              : 'Cliente';

            const paymentLink = payload.order_status_url || payload.checkout_url || '';

            const { data: queueInserted } = await supabaseAdmin.from('recovery_queue').insert({
              store_id: storeId,
              order_id: orderDbId,
              customer_id: customerId,
              status: 'pending',
              current_step: 1,
              last_sent_step: 0,
              scheduled_at: agendadoParaRecuperacao,
              next_action_at: agendadoParaRecuperacao,
              attempt_count: 0,
              metadata: {
                customer_name: customerName,
                customer_phone: cleanPhone,
                numero_pedido: orderNumber,
                valor_total: totalVal,
                order_status_url: payload.order_status_url || null,
                checkout_url: payload.checkout_url || null,
                payment_link: paymentLink,
                itens: payload.line_items?.map((item: any) => ({
                  title: item.title || item.name,
                  quantity: item.quantity,
                  price: item.price,
                })) || [],
              }
            }).select('id').single();

            if (queueInserted?.id) {
              await supabaseAdmin.from('recovery_events').insert({
                store_id: storeId,
                order_id: orderDbId,
                queue_id: queueInserted.id,
                event_type: 'enqueued',
                channel: 'whatsapp',
                metadata: { valor_total: totalVal, scheduled_at: agendadoParaRecuperacao },
              });
            }

            await supabaseAdmin.from('ai_recovery_conversations').insert({
              store_id: storeId,
              order_id: orderDbId,
              customer_phone: cleanPhone,
              customer_name: customerName,
              valor_pedido: totalVal,
              status: 'pendente_envio',
              agendado_para: agendadoParaRecuperacao,
              mensagens: [],
            });
            console.log(`[RECUPERAÇÃO] Pedido #${orderNumber} não pago agendado na recovery_queue para ${agendadoParaRecuperacao}`);
          }
        }
      }

      // 4. Criação do Rastreio (somente se for pedido novo)
      if (orderDbId && !existingOrder) {
        let retries = 3;
        let trackingCriado = false;
        
        while (retries > 0 && !trackingCriado) {
          const codigo = gerarCodigoRastreio(String(shopifyOrderId));
          const syncAfter = addOneBusinessDay().toISOString();
          const { error: trackingError } = await supabaseAdmin
            .from('trackings')
            .insert({
              store_id: storeId,
              order_id: orderDbId,
              codigo_rastreio: codigo,
              shopify_synced: false,
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

          if (!trackingError) {
            trackingCriado = true;
            console.log(`Rastreio ${codigo} gerado. Envio agendado para ${syncAfter}.`);
            // Nota: O envio real ocorrerá através do endpoint cron `/api/cron/sync-shopify`

            // Enfileira o pedido na Jornada de Rastreio de 15 Dias (fire-and-forget)
            if (storeId && orderDbId) {
              enqueueJourney(orderDbId, storeId).catch((err) =>
                console.error('[JOURNEY] Falha ao enfileirar jornada no webhook:', err)
              );
            }
          } else {
            console.warn(`Colisão de código de rastreio detectada. Retentando... (${retries} tentativas restantes)`);
            retries--;
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Erro no processamento do webhook:', error);
    return NextResponse.json({ error: error.message || 'Erro Interno' }, { status: 500 });
  }
}
