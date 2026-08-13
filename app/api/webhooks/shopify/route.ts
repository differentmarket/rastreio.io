import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyWebhook } from '@/lib/verifyShopifyWebhook';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { gerarCodigoRastreio } from '@/lib/gerarCodigoRastreio';
import { criptografar, gerarCpfHash } from '@/lib/criptografia';
import { ShopifyOrderWebhook } from '@/types/shopify';
import { getShopifyConfig, enviarRastreioShopify } from '@/lib/shopifyService';

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
    const rawBody = await req.text();
    const topic = req.headers.get('x-shopify-topic');
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256') || '';
    const shopDomainHeader = req.headers.get('x-shopify-shop-domain') || '';
    let storeId: string | null = null;
    if (shopDomainHeader) {
      try {
        const { data: store } = await supabaseAdmin
          .from('stores')
          .select('id')
          .eq('shopify_domain', shopDomainHeader.toLowerCase().trim())
          .maybeSingle();
        if (store) storeId = store.id;
      } catch (err) {
        // Ignora se tabela não existir
      }
    }

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

      // Busca configuração de delay para envio da Nota Fiscal e Agendamento da IA de Recuperação
      const { data: dbSettings } = await supabaseAdmin.from('settings').select('key, value');
      const cfg: Record<string, string> = {};
      dbSettings?.forEach(s => { cfg[s.key] = s.value; });
      const notaDelayHoras = parseInt(cfg['NOTA_DELAY_HORAS'] || '2', 10);
      const enviarNotaEm = new Date(Date.now() + notaDelayHoras * 3600 * 1000).toISOString();

      const aiDelayMinutes = parseInt(cfg['AI_DELAY_MINUTES'] || '15', 10);
      const agendadoParaRecuperacao = new Date(Date.now() + aiDelayMinutes * 60 * 1000).toISOString();

      // Extrair telefone do cliente para WhatsApp
      const rawPhone = payload.customer?.phone || (payload.shipping_address as any)?.phone || (payload.billing_address as any)?.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '');

      // 3. Upsert do Pedido
      let orderDbId: string | null = null;
      const { data: existingOrder } = await supabaseAdmin
        .from('orders')
        .select('id, status_pedido')
        .eq('shopify_order_id', shopifyOrderId)
        .maybeSingle();

      if (existingOrder) {
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

        // Se o pedido foi atualizado para PAGO, atualizar o status da recuperação de IA
        if (statusPedido === 'pago' || payload.financial_status === 'paid') {
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

          // Se for um novo pedido e estiver PENDENTE (não pago), agendar a recuperação por WhatsApp via IA
          if (statusPedido === 'pendente' && cleanPhone) {
            const customerName = payload.customer
              ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim()
              : 'Cliente';

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
            console.log(`[RECUPERAÇÃO IA] Pedido #${orderNumber} não pago agendado para envio via WhatsApp em ${agendadoParaRecuperacao}`);
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
