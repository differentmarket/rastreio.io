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

    // Busca o rastreamento com data de criação do pedido para calcular a jornada simulada
    const { data: tracking, error } = await supabaseAdmin
      .from('trackings')
      .select('codigo_rastreio, status, historico, updated_at, created_at, orders ( created_at )')
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

    // Carrega os dias de delay das configurações
    const { data: dbSettings } = await supabaseAdmin.from('settings').select('key, value');
    let delayPostado = 2;
    let delayTransito = 3;
    let delaySaiuEntrega = 1;
    dbSettings?.forEach(s => {
      if (s.key === 'DELAY_POSTADO_EM_TRANSITO') delayPostado = parseInt(s.value) || 2;
      if (s.key === 'DELAY_EM_TRANSITO_SAIU_ENTREGA') delayTransito = parseInt(s.value) || 3;
      if (s.key === 'DELAY_SAIU_ENTREGA_ENTREGUE') delaySaiuEntrega = parseInt(s.value) || 1;
    });

    const orderData: any = tracking.orders;
    const orderCreatedAtStr = orderData?.created_at || tracking.created_at;
    const history = Array.isArray(tracking.historico) ? tracking.historico : [];
    let status = tracking.status;

    // Se o histórico contém apenas a postagem inicial, fazemos a simulação da jornada
    if (history.length <= 1 && orderCreatedAtStr && status !== 'extraviado') {
      const orderCreatedAt = new Date(orderCreatedAtStr);
      const timeDiffMs = Date.now() - orderCreatedAt.getTime();
      const daysDiff = timeDiffMs / (1000 * 60 * 60 * 24);

      const simulatedHistory = [...history];

      // 1. Postado
      if (simulatedHistory.length === 0) {
        simulatedHistory.push({
          status: 'postado',
          data: orderCreatedAt.toISOString(),
          descricao: 'Pedido recebido no sistema e aguardando postagem.',
          local: 'Logística Interna'
        });
      }

      // 1.1 Atualização extra no mesmo dia da postagem (ou 0.5 dia depois)
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

      // 2.1 Em Trânsito - Segunda atualização no mesmo dia de trânsito (0.5 dia após a chegada na unidade de tratamento)
      const transitoChegadaDate = ajustarParaHorarioComercial(new Date(orderCreatedAt.getTime() + (delayPostado + 0.5) * 24 * 60 * 60 * 1000));
      if (daysDiff >= (delayPostado + 0.5) && transitoChegadaDate.getTime() <= Date.now()) {
        simulatedHistory.push({
          status: 'em_transito',
          data: transitoChegadaDate.toISOString(),
          descricao: 'Objeto recebido na Unidade de Tratamento de destino.',
          local: 'Unidade de Tratamento, Curitiba - PR'
        });
      }

      // 2.2 Em Trânsito - Encaminhado para a unidade de distribuição local (1.5 dias após entrar em trânsito)
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

      // 4. Entregue
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

      return NextResponse.json({
        codigo: tracking.codigo_rastreio,
        status,
        historico: simulatedHistory,
        atualizado_em: tracking.updated_at,
      });
    }

    return NextResponse.json({
      codigo: tracking.codigo_rastreio,
      status: tracking.status,
      historico: tracking.historico,
      atualizado_em: tracking.updated_at,
    });
  } catch (err: any) {
    console.error('Erro na consulta de rastreamento:', err);
    return NextResponse.json(
      { error: err.message || 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}
