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
  // 1. Procurar em note_attributes
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

  // 2. Procurar em customer.tags
  if (payload.customer && payload.customer.tags) {
    const tags = payload.customer.tags.split(',').map((t) => t.trim());
    // Procurar por tag contendo "cpf:" ou que seja apenas números de 11 dígitos
    for (const tag of tags) {
      if (tag.toLowerCase().startsWith('cpf:')) {
        return tag.substring(4).replace(/\D/g, '');
      }
      const numbersOnly = tag.replace(/\D/g, '');
      if (numbersOnly.length === 11) {
        return numbersOnly;
      }
    }
  }

  return '';
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256') || '';
    const topic = req.headers.get('x-shopify-topic');

    const config = await getShopifyConfig();

    // Validação da assinatura
    if (!verifyShopifyWebhook(rawBody, hmacHeader, config.webhookSecret)) {
      console.warn('Recebido webhook com HMAC inválido.');
      return NextResponse.json({ error: 'HMAC inválido' }, { status: 401 });
    }

    const payload: ShopifyOrderWebhook = JSON.parse(rawBody);

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

      // 3. Upsert do Pedido
      let orderDbId: string | null = null;
      const { data: existingOrder } = await supabaseAdmin
        .from('orders')
        .select('id')
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
      } else {
        const { data: newOrder, error } = await supabaseAdmin
          .from('orders')
          .insert({
            shopify_order_id: shopifyOrderId,
            customer_id: customerId,
            address_id: addressId,
            numero_pedido: orderNumber,
            status_pedido: statusPedido,
            valor_total: totalVal,
            itens: payload.line_items,
            raw_payload: payload,
          })
          .select('id')
          .single();

        if (error) {
          console.error('Erro ao criar pedido:', error);
        } else {
          orderDbId = newOrder.id;
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
              order_id: orderDbId,
              codigo_rastreio: codigo,
              shopify_synced: false,
              sync_after: syncAfter,
              status: 'postado',
              historico: [
                {
                  status: 'postado',
                  data: new Date().toISOString(),
                  descricao: 'Pedido recebido no sistema e aguardando postagem.',
                  local: 'Logística Interna',
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
