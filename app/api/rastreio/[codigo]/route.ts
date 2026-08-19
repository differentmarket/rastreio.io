import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function ajustarParaHorarioComercial(date: Date): Date {
  const adjusted = new Date(date);
  // Define uma hora comercial aleatória entre 08:00 e 17:00
  const randomHour = Math.floor(Math.random() * (17 - 8 + 1)) + 8;
  const randomMinute = Math.floor(Math.random() * 60);
  
  adjusted.setHours(randomHour, randomMinute, 0, 0);

  // Se cair no final de semana (sábado ou domingo), movemos para segunda-feira
  const dayOfWeek = adjusted.getDay(); // 0 = Domingo, 6 = Sábado
  if (dayOfWeek === 0) { // Domingo -> segunda
    adjusted.setDate(adjusted.getDate() + 1);
  } else if (dayOfWeek === 6) { // Sábado -> segunda
    adjusted.setDate(adjusted.getDate() + 2);
  }
  return adjusted;
}

function sanitizeHistory(events: any[]) {
  if (!Array.isArray(events)) return [];
  return events.map((ev: any) => {
    let descricao = ev.descricao || '';
    let local = ev.local || '';

    if (descricao.includes('Shopify') || descricao.includes('sincronizado') || descricao === 'Pedido recebido no sistema e aguardando postagem.') {
      descricao = 'Pedido confirmado e em preparação para envio.';
    }
    if (local === 'Logística Interna' || local === 'Shopify') {
      local = 'Centro de Distribuição';
    }

    return {
      ...ev,
      descricao,
      local,
    };
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  try {
    const { codigo } = await params;

    if (!codigo) {
      return NextResponse.json(
        { error: 'Código de rastreio não fornecido.' },
        { status: 400 }
      );
    }

    // Bypass com dados mockados para consulta pública de rastreio
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl.includes('mock-project')) {
      const cleanCodigo = codigo.toUpperCase().trim();
      const mockTrackings: Record<string, any> = {
        "BR2607X8F3K9": {
          codigo_rastreio: "BR2607X8F3K9",
          status: "entregue",
          historico: [
            { status: "postado", data: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto postado pela loja", local: "Central de Logística, São Paulo - SP" },
            { status: "em_transito", data: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto encaminhado para Unidade de Tratamento", local: "Unidade de Tratamento, Curitiba - PR" },
            { status: "saiu_para_entrega", data: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto saiu para entrega ao destinatário", local: "CDD Centro, Curitiba - PR" },
            { status: "entregue", data: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000).toISOString(), descricao: "Objeto entregue ao destinatário", local: "Curitiba - PR" }
          ],
          updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
        },
        "BR2607A3F9K1": {
          codigo_rastreio: "BR2607A3F9K1",
          status: "em_transito",
          historico: [
            { status: "postado", data: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto postado pela loja", local: "Central de Logística, São Paulo - SP" },
            { status: "em_transito", data: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), descricao: "Objeto em trânsito para Unidade de Distribuição", local: "CTE Benfica, Rio de Janeiro - RJ" }
          ],
          updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
        },
        "BR2607T4Y7P2": {
          codigo_rastreio: "BR2607T4Y7P2",
          status: "postado",
          historico: [
            { status: "postado", data: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), descricao: "Objeto postado pela loja", local: "Central de Logística, São Paulo - SP" }
          ],
          updated_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
        }
      };

      const tracking = mockTrackings[cleanCodigo];
      if (tracking) {
        return NextResponse.json({
          codigo: tracking.codigo_rastreio,
          status: tracking.status,
          historico: tracking.historico,
          atualizado_em: tracking.updated_at,
        });
      }
      return NextResponse.json({ error: 'Código de rastreio não encontrado.' }, { status: 404 });
    }

    // Busca o rastreamento com dados do pedido, cliente e loja
    const { data: tracking, error } = await supabaseAdmin
      .from('trackings')
      .select('codigo_rastreio, status, historico, updated_at, created_at, store_id, orders ( id, numero_pedido, created_at, valor_total, customer_id, store_id, itens )')
      .eq('codigo_rastreio', codigo.toUpperCase().trim())
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar rastreamento:', error);
      return NextResponse.json(
        { error: 'Erro ao processar a consulta.' },
        { status: 500 }
      );
    }

    if (!tracking) {
      return NextResponse.json(
        { error: 'Código de rastreio não encontrado.' },
        { status: 404 }
      );
    }

    // Buscar dados de White-Label da Loja
    let storeCustomization = null;
    const targetStoreId = tracking.store_id || (tracking.orders as any)?.store_id;
    if (targetStoreId) {
      const { data: store } = await supabaseAdmin
        .from('stores')
        .select('nome_loja, logo_url, primary_color, banner_url, banner_link, whatsapp_suporte, veopag_enabled')
        .eq('id', targetStoreId)
        .maybeSingle();
      if (store) {
        storeCustomization = store;
      }
    }

    // Buscar dados do cliente associado ao pedido
    let customerInfo = null;
    const orderData: any = tracking.orders;
    if (orderData?.customer_id) {
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .select('nome, email, cpf_encrypted')
        .eq('id', orderData.customer_id)
        .maybeSingle();
      
      if (customer) {
        let cpfDescriptografado = '';
        if (customer.cpf_encrypted) {
          try {
            // Conversão de bytea do Postgres para Buffer
            let bufferCpf: Buffer;
            if (typeof customer.cpf_encrypted === 'string') {
              // Remove o prefixo '\x' do bytea retornado pelo PostgREST se presente
              const hex = customer.cpf_encrypted.startsWith('\\x') 
                ? customer.cpf_encrypted.substring(2) 
                : customer.cpf_encrypted;
              bufferCpf = Buffer.from(hex, 'hex');
            } else {
              bufferCpf = Buffer.from(customer.cpf_encrypted);
            }
            
            const { descriptografar } = require('@/lib/criptografia');
            cpfDescriptografado = descriptografar(bufferCpf);
          } catch (errDec) {
            console.error('Erro ao descriptografar CPF do cliente:', errDec);
          }
        }

        // Ocultar alguns dígitos do CPF (Ex: 123.***.***-00)
        let cpfMascarado = 'Não informado';
        if (cpfDescriptografado) {
          const cpfLimpo = cpfDescriptografado.replace(/\D/g, '');
          if (cpfLimpo.length === 11) {
            cpfMascarado = `${cpfLimpo.substring(0, 3)}.***.***-${cpfLimpo.substring(9, 11)}`;
          } else {
            cpfMascarado = '***.***.***-**';
          }
        }
        customerInfo = {
          nome: customer.nome,
          email: customer.email,
          cpf: cpfMascarado,
        };
      }
    }

    // Carrega as configurações dinâmicas
    const { data: dbSettings } = await supabaseAdmin.from('settings').select('key, value');
    const cfg: Record<string, string> = {};
    dbSettings?.forEach(s => { cfg[s.key] = s.value; });

    const delayPostado = parseInt(cfg['DELAY_POSTADO_EM_TRANSITO'] || '2', 10);
    const delayTransito = parseInt(cfg['DELAY_EM_TRANSITO_SAIU_ENTREGA'] || '3', 10);
    const delaySaiuEntrega = parseInt(cfg['DELAY_SAIU_ENTREGA_ENTREGUE'] || '1', 10);

    const taxaEnabled = cfg['TAXA_ENABLED'] !== 'false';
    const taxaDiaExibicao = parseInt(cfg['TAXA_DIA_EXIBICAO'] || '11', 10);
    const taxaNome = cfg['TAXA_NOME'] || 'Taxa de Despacho Postal e Liberação Alfandegária';
    const taxaValor = cfg['TAXA_VALOR'] || '27.90';
    const taxaLink = cfg['TAXA_LINK_PAGAMENTO'] || '';

    const upsellEnabled = cfg['UPSELL_ENABLED'] === 'true';
    const upsellTitle = cfg['UPSELL_TITLE'] || 'Ganhe 15% OFF na sua próxima compra!';
    const upsellDescription = cfg['UPSELL_DESCRIPTION'] || 'Use o cupom CLIENTE15 no checkout e aproveite frete grátis.';
    const upsellLink = cfg['UPSELL_LINK'] || '';
    const upsellImageUrl = cfg['UPSELL_IMAGE_URL'] || '';

    const orderCreatedAtStr = orderData?.created_at || tracking.created_at;
    const history = Array.isArray(tracking.historico) ? tracking.historico : [];
    let status = tracking.status;

    const orderCreatedAt = orderCreatedAtStr ? new Date(orderCreatedAtStr) : new Date(tracking.created_at);
    const timeDiffMs = Date.now() - orderCreatedAt.getTime();
    const daysDiff = timeDiffMs / (1000 * 60 * 60 * 24);

    // Se o histórico contém apenas a postagem inicial, fazemos a simulação da jornada inteligente
    if (history.length <= 1 && orderCreatedAtStr && status !== 'extraviado') {
      const simulatedHistory = [...history];

      // 1. Postado
      if (simulatedHistory.length === 0) {
        simulatedHistory.push({
          status: 'postado',
          data: orderCreatedAt.toISOString(),
          descricao: 'Pedido confirmado e em preparação para envio.',
          local: 'Centro de Distribuição'
        });
      }

      // 1.1 Atualização extra no mesmo dia da postagem
      const postadoExtraDate = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + 0.5 * 24 * 60 * 60 * 1000));
      if (daysDiff >= 0.5 && postadoExtraDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'postado',
          data: postadoExtraDate.toISOString(),
          descricao: 'Objeto preparado e etiquetado para envio.',
          local: 'Central de Logística, São Paulo - SP'
        });
      }

      // 1.2 Encaminhado para tratamento (1 dia depois da criação)
      const postadoEncaminhadoDate = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + 1.0 * 24 * 60 * 60 * 1000));
      if (daysDiff >= 1.0 && postadoEncaminhadoDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'postado',
          data: postadoEncaminhadoDate.toISOString(),
          descricao: 'Objeto recebido na unidade de tratamento de origem.',
          local: 'Agência dos Correios, São Paulo - SP'
        });
      }

      // 2. Em Trânsito
      const transitoDate = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + delayPostado * 24 * 60 * 60 * 1000));
      if (daysDiff >= delayPostado && transitoDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'em_transito',
          data: transitoDate.toISOString(),
          descricao: 'Objeto encaminhado para Unidade de Tratamento',
          local: 'Unidade de Tratamento, Curitiba - PR'
        });
        status = 'em_transito';
      }

      // 2.1 Em Trânsito - Segunda atualização
      const transitoChegadaDate = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + (delayPostado + 0.5) * 24 * 60 * 60 * 1000));
      if (daysDiff >= (delayPostado + 0.5) && transitoChegadaDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'em_transito',
          data: transitoChegadaDate.toISOString(),
          descricao: 'Objeto recebido na Unidade de Tratamento de destino.',
          local: 'Unidade de Tratamento, Curitiba - PR'
        });
      }

      // 2.2 Encaminhado para a unidade de distribuição local
      const transitoLocalDate = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + (delayPostado + 1.5) * 24 * 60 * 60 * 1000));
      if (daysDiff >= (delayPostado + 1.5) && transitoLocalDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'em_transito',
          data: transitoLocalDate.toISOString(),
          descricao: 'Objeto encaminhado para Unidade de Distribuição',
          local: 'CDD Centro, Curitiba - PR'
        });
      }

      // 3. Saiu para Entrega
      const saiuDate = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + (delayPostado + delayTransito) * 24 * 60 * 60 * 1000));
      if (daysDiff >= (delayPostado + delayTransito) && saiuDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'saiu_para_entrega',
          data: saiuDate.toISOString(),
          descricao: 'Objeto saiu para entrega ao destinatário',
          local: 'CDD Centro, Curitiba - PR'
        });
        status = 'saiu_para_entrega';
      }

      // 4. Retentativas de Entrega nos dias 9, 10 e 11 se a taxa estiver ativada
      if (taxaEnabled) {
        // Dia 9: 1ª tentativa
        const dia9Date = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + 9.0 * 24 * 60 * 60 * 1000));
        if (daysDiff >= 9.0 && dia9Date.getTime() <= Date.now()) {
          simulatedHistory.push({
            status: 'saiu_para_entrega',
            data: dia9Date.toISOString(),
            descricao: '1ª tentativa de entrega não atendida - Carteiro não atendido.',
            local: 'CDD Distribuição Local'
          });
        }

        // Dia 10: 2ª tentativa
        const dia10Date = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + 10.0 * 24 * 60 * 60 * 1000));
        if (daysDiff >= 10.0 && dia10Date.getTime() <= Date.now()) {
          simulatedHistory.push({
            status: 'saiu_para_entrega',
            data: dia10Date.toISOString(),
            descricao: '2ª tentativa de entrega não atendida - Destinatário ausente.',
            local: 'CDD Distribuição Local'
          });
        }

        // Dia 11: 3ª tentativa & Pendente de Taxa
        const dia11Date = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + 11.0 * 24 * 60 * 60 * 1000));
        if (daysDiff >= 11.0 && dia11Date.getTime() <= Date.now()) {
          simulatedHistory.push({
            status: 'pendente_taxa',
            data: dia11Date.toISOString(),
            descricao: '3ª tentativa de entrega não atendida. Objeto retido - Pendente de pagamento de taxa para liberação do reenvio.',
            local: 'Central de Distribuição dos Correios / Alfândega'
          });
          status = 'pendente_taxa';
        }
      } else {
        // Se a taxa não estiver ativada, segue o fluxo normal para Entregue
        const entregueDate = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + (delayPostado + delayTransito + delaySaiuEntrega) * 24 * 60 * 60 * 1000));
        if (daysDiff >= (delayPostado + delayTransito + delaySaiuEntrega) && entregueDate.getTime() <= Date.now()) {
          simulatedHistory.push({
            status: 'entregue',
            data: entregueDate.toISOString(),
            descricao: 'Objeto entregue ao destinatário',
            local: 'Curitiba - PR'
          });
          status = 'entregue';
        }
      }

      return NextResponse.json({
        codigo: tracking.codigo_rastreio,
        status,
        historico: sanitizeHistory(simulatedHistory),
        atualizado_em: tracking.updated_at,
        customer: customerInfo,
        numero_pedido: orderData?.numero_pedido || null,
        itens: orderData?.itens || [],
        store: storeCustomization,
        taxa_info: {
          exibir: taxaEnabled && daysDiff >= taxaDiaExibicao,
          nome: taxaNome,
          valor: taxaValor,
          link: taxaLink,
          veopag_enabled: storeCustomization?.veopag_enabled || false,
        },
        upsell_info: {
          ativo: upsellEnabled,
          titulo: upsellTitle,
          descricao: upsellDescription,
          link: upsellLink,
          imagem_url: upsellImageUrl,
        },
      });
    }

    return NextResponse.json({
      codigo: tracking.codigo_rastreio,
      status: tracking.status,
      historico: sanitizeHistory(tracking.historico),
      atualizado_em: tracking.updated_at,
      customer: customerInfo,
      numero_pedido: orderData?.numero_pedido || null,
      itens: orderData?.itens || [],
      store: storeCustomization,
      taxa_info: {
        exibir: taxaEnabled && daysDiff >= taxaDiaExibicao,
        nome: taxaNome,
        valor: taxaValor,
        link: taxaLink,
        veopag_enabled: storeCustomization?.veopag_enabled || false,
      },
      upsell_info: {
        ativo: upsellEnabled,
        titulo: upsellTitle,
        descricao: upsellDescription,
        link: upsellLink,
        imagem_url: upsellImageUrl,
      },
    });
  } catch (err: any) {
    console.error('Erro na consulta de rastreamento:', err);
    return NextResponse.json(
      { error: err.message || 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}
