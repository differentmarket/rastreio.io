import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function gerarDataEvento(
  baseDate: Date,
  diasOffset: number,
  horaBrasilia: number,
  minutoBrasilia: number,
  dataAnteriorMinima?: Date
): Date {
  const dt = new Date(baseDate);
  // Adiciona a quantidade de dias
  dt.setDate(dt.getDate() + Math.floor(diasOffset));

  // Ajusta finais de semana para dias úteis (sábado -> segunda, domingo -> segunda)
  const dayOfWeek = dt.getDay();
  if (dayOfWeek === 0) { // Domingo -> segunda (+1 dia)
    dt.setDate(dt.getDate() + 1);
  } else if (dayOfWeek === 6) { // Sábado -> segunda (+2 dias)
    dt.setDate(dt.getDate() + 2);
  }

  // Horário de Brasília (UTC-3). No servidor UTC, horaUTC = horaBrasilia + 3
  const horaUTC = (horaBrasilia + 3) % 24;
  dt.setUTCHours(horaUTC, minutoBrasilia, 0, 0);

  // Garante estritamente que a nova data seja SEMPRE maior que a data do evento anterior
  if (dataAnteriorMinima && dt.getTime() <= dataAnteriorMinima.getTime()) {
    return new Date(dataAnteriorMinima.getTime() + 2.5 * 60 * 60 * 1000);
  }

  return dt;
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
      .select('codigo_rastreio, status, historico, updated_at, created_at, store_id, orders ( id, numero_pedido, created_at, valor_total, customer_id, store_id, itens, addresses ( cidade, estado ) )')
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
        .select('nome_loja, logo_url, primary_color, banner_url, banner_link, whatsapp_suporte, veopag_enabled, empresa_cidade, empresa_estado, taxa_enabled, taxa_nome, taxa_valor, taxa_link_pagamento, taxa_dias_tentativas, taxa_dia_exibicao, order_bump_bradesco_enabled, order_bump_bradesco_valor, order_bump_express_enabled, order_bump_express_valor, upsell_enabled, upsell_title, upsell_description, upsell_coupon, upsell_link, upsell_image_url')
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

    const taxaEnabled = storeCustomization?.taxa_enabled !== undefined 
      ? storeCustomization.taxa_enabled 
      : (cfg['TAXA_ENABLED'] !== 'false');

    const taxaDiaExibicao = storeCustomization?.taxa_dia_exibicao !== undefined && storeCustomization?.taxa_dia_exibicao !== null
      ? parseInt(storeCustomization.taxa_dia_exibicao, 10)
      : parseInt(cfg['TAXA_DIA_EXIBICAO'] || '11', 10);

    const taxaNome = storeCustomization?.taxa_nome || cfg['TAXA_NOME'] || 'Taxa de Despacho Postal e Liberação Alfandegária';
    const taxaValor = storeCustomization?.taxa_valor !== undefined && storeCustomization?.taxa_valor !== null
      ? String(storeCustomization.taxa_valor)
      : cfg['TAXA_VALOR'] || '27.90';

    const taxaLink = storeCustomization?.taxa_link_pagamento || cfg['TAXA_LINK_PAGAMENTO'] || '';

    const diasTentativasStr = storeCustomization?.taxa_dias_tentativas || cfg['TAXA_DIAS_TENTATIVAS'] || '9,10,11';
    const diasTentativas = diasTentativasStr.split(',').map((d: string) => parseFloat(d.trim())).filter((d: number) => !isNaN(d));
    const dia1 = diasTentativas[0] !== undefined ? diasTentativas[0] : 9.0;
    const dia2 = diasTentativas[1] !== undefined ? diasTentativas[1] : 10.0;
    const dia3 = diasTentativas[2] !== undefined ? diasTentativas[2] : 11.0;

    const upsellEnabled = storeCustomization?.upsell_enabled !== undefined 
      ? storeCustomization.upsell_enabled 
      : (cfg['UPSELL_ENABLED'] === 'true');
    const upsellTitle = storeCustomization?.upsell_title || cfg['UPSELL_TITLE'] || 'Ganhe 15% OFF na sua próxima compra!';
    const upsellDescription = storeCustomization?.upsell_description || cfg['UPSELL_DESCRIPTION'] || 'Use o cupom no checkout e aproveite frete grátis.';
    const upsellCoupon = storeCustomization?.upsell_coupon || cfg['UPSELL_COUPON'] || 'CLIENTE15';
    const upsellLink = storeCustomization?.upsell_link || cfg['UPSELL_LINK'] || '';
    const upsellImageUrl = storeCustomization?.upsell_image_url || cfg['UPSELL_IMAGE_URL'] || '';

    const orderCreatedAtStr = orderData?.created_at || tracking.created_at;
    const history = Array.isArray(tracking.historico) ? tracking.historico : [];
    let status = tracking.status;

    const orderCreatedAt = orderCreatedAtStr ? new Date(orderCreatedAtStr) : new Date(tracking.created_at);
    const timeDiffMs = Date.now() - orderCreatedAt.getTime();
    const daysDiff = timeDiffMs / (1000 * 60 * 60 * 24);

    // Verificar se existe pagamento no histórico para ocultar após 2 dias
    const eventoPagamento = history.find((h: any) => 
      h.descricao && h.descricao.toLowerCase().includes('taxa de liberação paga com sucesso')
    );

    let exibirTaxaFinal = taxaEnabled && daysDiff >= taxaDiaExibicao;

    if (eventoPagamento) {
      const dataPagamento = new Date(eventoPagamento.data);
      const tempoDesdePagamentoMs = Date.now() - dataPagamento.getTime();
      const diasDesdePagamento = tempoDesdePagamentoMs / (1000 * 60 * 60 * 24);

      if (diasDesdePagamento > 2.0) {
        exibirTaxaFinal = false;
      }
    }

    const taxaPaga = !!eventoPagamento;

    // Se o histórico contém apenas a postagem inicial, fazemos a simulação da jornada inteligente
    if (history.length <= 1 && orderCreatedAtStr && status !== 'extraviado') {
      const simulatedHistory = [...history];

      // Determinar dados de localidade reais
      const cidadeOrigem = storeCustomization?.empresa_cidade?.trim() || 'São Paulo';
      const estadoOrigem = (storeCustomization?.empresa_estado?.trim() || 'SP').toUpperCase();
      const cidadeDestino = (orderData as any)?.addresses?.cidade?.trim() || 'Curitiba';
      const estadoDestino = ((orderData as any)?.addresses?.estado?.trim() || 'PR').toUpperCase();

      const mapHubs: Record<string, string> = {
        SP: 'Cajamar - SP',
        RJ: 'Rio de Janeiro - RJ',
        MG: 'Contagem - MG',
        ES: 'Vitória - ES',
        PR: 'Pinhais - PR',
        SC: 'Pinhais - PR',
        RS: 'Pinhais - PR',
        DF: 'Brasília - DF',
        GO: 'Brasília - DF',
        MT: 'Brasília - DF',
        MS: 'Pinhais - PR',
        PE: 'Recife - PE',
        PB: 'Recife - PE',
        RN: 'Recife - PE',
        AL: 'Recife - PE',
        SE: 'Recife - PE',
        BA: 'Salvador - BA',
        MA: 'São Luís - MA'
      };

      const getHubName = (uf: string) => {
        return mapHubs[uf] || `Unidade de Tratamento, ${uf}`;
      };

      const localHubOrigem = getHubName(estadoOrigem);
      const localHubDestino = getHubName(estadoDestino);

      // 1. Postado
      if (simulatedHistory.length === 0) {
        simulatedHistory.push({
          status: 'postado',
          data: orderCreatedAt.toISOString(),
          descricao: 'Pedido confirmado e em preparação para envio.',
          local: `Centro de Distribuição, ${cidadeOrigem} - ${estadoOrigem}`
        });
      }

      let lastEventDate = new Date(simulatedHistory[simulatedHistory.length - 1].data);

      // 1.1 Atualização extra no mesmo dia da postagem (às 14:20 de Brasília)
      const postadoExtraDate = gerarDataEvento(orderCreatedAt, 0.4, 14, 20, lastEventDate);
      if (daysDiff >= 0.4 && postadoExtraDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'postado',
          data: postadoExtraDate.toISOString(),
          descricao: 'Objeto preparado e etiquetado para envio.',
          local: `Central de Logística, ${cidadeOrigem} - ${estadoOrigem}`
        });
        lastEventDate = postadoExtraDate;
      }

      // 1.2 Encaminhado para tratamento (dia seguinte às 09:15 de Brasília)
      const postadoEncaminhadoDate = gerarDataEvento(orderCreatedAt, 1.0, 9, 15, lastEventDate);
      if (daysDiff >= 1.0 && postadoEncaminhadoDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'postado',
          data: postadoEncaminhadoDate.toISOString(),
          descricao: 'Objeto recebido na unidade de tratamento de origem.',
          local: `Agência dos Correios, ${cidadeOrigem} - ${estadoOrigem}`
        });
        lastEventDate = postadoEncaminhadoDate;
      }

      // 2. Em Trânsito (às 11:40 de Brasília)
      const transitoDate = gerarDataEvento(orderCreatedAt, delayPostado, 11, 40, lastEventDate);
      if (daysDiff >= delayPostado && transitoDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'em_transito',
          data: transitoDate.toISOString(),
          descricao: 'Objeto encaminhado para Unidade de Tratamento',
          local: `Unidade de Tratamento, ${localHubOrigem}`
        });
        status = 'em_transito';
        lastEventDate = transitoDate;
      }

      // 2.1 Em Trânsito - Segunda atualização (chegada no hub destino às 15:10 de Brasília)
      const transitoChegadaDate = gerarDataEvento(orderCreatedAt, delayPostado + 1.0, 15, 10, lastEventDate);
      if (daysDiff >= (delayPostado + 1.0) && transitoChegadaDate.getTime() <= Date.now()) {
        const destHub = estadoOrigem === estadoDestino ? localHubOrigem : localHubDestino;
        simulatedHistory.push({
          status: 'em_transito',
          data: transitoChegadaDate.toISOString(),
          descricao: 'Objeto recebido na Unidade de Tratamento de destino.',
          local: `Unidade de Tratamento, ${destHub}`
        });
        lastEventDate = transitoChegadaDate;
      }

      // 2.2 Encaminhado para a unidade de distribuição local (às 08:45 de Brasília)
      const transitoLocalDate = gerarDataEvento(orderCreatedAt, delayPostado + 2.0, 8, 45, lastEventDate);
      if (daysDiff >= (delayPostado + 2.0) && transitoLocalDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'em_transito',
          data: transitoLocalDate.toISOString(),
          descricao: 'Objeto encaminhado para Unidade de Distribuição',
          local: `CDD Centro, ${cidadeDestino} - ${estadoDestino}`
        });
        lastEventDate = transitoLocalDate;
      }

      // 3. Saiu para Entrega (às 10:30 de Brasília)
      const saiuDate = gerarDataEvento(orderCreatedAt, delayPostado + delayTransito, 10, 30, lastEventDate);
      if (daysDiff >= (delayPostado + delayTransito) && saiuDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'saiu_para_entrega',
          data: saiuDate.toISOString(),
          descricao: 'Objeto saiu para entrega ao destinatário',
          local: `CDD Centro, ${cidadeDestino} - ${estadoDestino}`
        });
        status = 'saiu_para_entrega';
        lastEventDate = saiuDate;
      }

      // 4. Retentativas de Entrega nos dias 9, 10 e 11 se a taxa estiver ativada
      if (taxaEnabled) {
        // 1ª tentativa
        const dia9Date = gerarDataEvento(orderCreatedAt, dia1, 16, 20, lastEventDate);
        if (daysDiff >= dia1 && dia9Date.getTime() <= Date.now()) {
          simulatedHistory.push({
            status: 'saiu_para_entrega',
            data: dia9Date.toISOString(),
            descricao: '1ª tentativa de entrega não atendida - Carteiro não atendido.',
            local: `CDD Centro, ${cidadeDestino} - ${estadoDestino}`
          });
          lastEventDate = dia9Date;
        }

        // 2ª tentativa
        const dia10Date = gerarDataEvento(orderCreatedAt, dia2, 15, 45, lastEventDate);
        if (daysDiff >= dia2 && dia10Date.getTime() <= Date.now()) {
          simulatedHistory.push({
            status: 'saiu_para_entrega',
            data: dia10Date.toISOString(),
            descricao: '2ª tentativa de entrega não atendida - Destinatário ausente.',
            local: `CDD Centro, ${cidadeDestino} - ${estadoDestino}`
          });
          lastEventDate = dia10Date;
        }

        // 3ª tentativa & Pendente de Taxa
        const dia11Date = gerarDataEvento(orderCreatedAt, dia3, 11, 15, lastEventDate);
        if (daysDiff >= dia3 && dia11Date.getTime() <= Date.now()) {
          simulatedHistory.push({
            status: 'pendente_taxa',
            data: dia11Date.toISOString(),
            descricao: '3ª tentativa de entrega não atendida. Objeto retido - Pendente de pagamento de taxa para liberação do reenvio.',
            local: `Central de Distribuição, ${cidadeDestino} - ${estadoDestino} / Alfândega`
          });
          status = 'pendente_taxa';
          lastEventDate = dia11Date;
        }
      } else {
        // Se a taxa não estiver ativada, segue o fluxo normal para Entregue às 14:50
        const entregueDate = gerarDataEvento(orderCreatedAt, delayPostado + delayTransito + delaySaiuEntrega, 14, 50, lastEventDate);
        if (daysDiff >= (delayPostado + delayTransito + delaySaiuEntrega) && entregueDate.getTime() <= Date.now()) {
          simulatedHistory.push({
            status: 'entregue',
            data: entregueDate.toISOString(),
            descricao: 'Objeto entregue ao destinatário',
            local: `${cidadeDestino} - ${estadoDestino}`
          });
          status = 'entregue';
          lastEventDate = entregueDate;
        }
      }

      // Validação final de garantia estrita: nenhum evento pode ter timestamp menor ou igual ao evento anterior
      for (let i = 1; i < simulatedHistory.length; i++) {
        const prevMs = new Date(simulatedHistory[i - 1].data).getTime();
        const currMs = new Date(simulatedHistory[i].data).getTime();
        if (currMs <= prevMs) {
          simulatedHistory[i].data = new Date(prevMs + 2.5 * 60 * 60 * 1000).toISOString();
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
        store: storeCustomization ? {
          ...storeCustomization,
          order_bump_bradesco_enabled: storeCustomization.order_bump_bradesco_enabled !== undefined ? storeCustomization.order_bump_bradesco_enabled : true,
          order_bump_bradesco_valor: storeCustomization.order_bump_bradesco_valor !== undefined ? parseFloat(storeCustomization.order_bump_bradesco_valor) : 14.76,
          order_bump_express_enabled: storeCustomization.order_bump_express_enabled !== undefined ? storeCustomization.order_bump_express_enabled : true,
          order_bump_express_valor: storeCustomization.order_bump_express_valor !== undefined ? parseFloat(storeCustomization.order_bump_express_valor) : 9.91,
        } : null,
        taxa_info: {
          exibir: exibirTaxaFinal,
          paga: taxaPaga,
          nome: taxaNome,
          valor: taxaValor,
          link: taxaLink,
          veopag_enabled: storeCustomization?.veopag_enabled || false,
        },
        upsell_info: {
          ativo: upsellEnabled,
          titulo: upsellTitle,
          descricao: upsellDescription,
          cupom: upsellCoupon,
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
      store: storeCustomization ? {
        ...storeCustomization,
        order_bump_bradesco_enabled: storeCustomization.order_bump_bradesco_enabled !== undefined ? storeCustomization.order_bump_bradesco_enabled : true,
        order_bump_bradesco_valor: storeCustomization.order_bump_bradesco_valor !== undefined ? parseFloat(storeCustomization.order_bump_bradesco_valor) : 14.76,
        order_bump_express_enabled: storeCustomization.order_bump_express_enabled !== undefined ? storeCustomization.order_bump_express_enabled : true,
        order_bump_express_valor: storeCustomization.order_bump_express_valor !== undefined ? parseFloat(storeCustomization.order_bump_express_valor) : 9.91,
      } : null,
      taxa_info: {
        exibir: exibirTaxaFinal,
        paga: taxaPaga,
        nome: taxaNome,
        valor: taxaValor,
        link: taxaLink,
        veopag_enabled: storeCustomization?.veopag_enabled || false,
      },
      upsell_info: {
        ativo: upsellEnabled,
        titulo: upsellTitle,
        descricao: upsellDescription,
        cupom: upsellCoupon,
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
