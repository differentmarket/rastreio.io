import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('store_id');

    let query = supabaseAdmin
      .from('ai_recovery_conversations')
      .select('*, orders ( numero_pedido, valor_total, created_at )')
      .order('created_at', { ascending: false })
      .limit(50);

    if (storeId && storeId !== 'all') {
      query = query.eq('store_id', storeId);
    }

    const { data: conversations, error } = await query;

    if (error) {
      return NextResponse.json({
        metrics: {
          total_contatados: 0,
          total_engajados: 0,
          total_convertidos: 0,
          faturamento_recuperado: 0,
          taxa_conversao: 0,
        },
        conversations: [],
      });
    }

    const convList = conversations || [];

    // Cálculo das métricas de recuperações de vendas
    let totalContatados = 0;
    let totalEngajados = 0;
    let totalConvertidos = 0;
    let faturamentoRecuperado = 0;

    convList.forEach((conv: any) => {
      const isContatado = ['em_andamento', 'convertido', 'nao_convertido'].includes(conv.status);
      if (isContatado) totalContatados++;

      const msgs = Array.isArray(conv.mensagens) ? conv.mensagens : [];
      const temRespostaCliente = msgs.some((m: any) => m.sender === 'customer' || m.sender === 'user');
      if (temRespostaCliente) totalEngajados++;

      if (conv.status === 'convertido') {
        totalConvertidos++;
        const valor = parseFloat(conv.valor_pedido || conv.orders?.valor_total || 0);
        faturamentoRecuperado += isNaN(valor) ? 0 : valor;
      }
    });

    const taxaConversao = totalContatados > 0 ? (totalConvertidos / totalContatados) * 100 : 0;

    return NextResponse.json({
      metrics: {
        total_contatados: totalContatados,
        total_engajados: totalEngajados,
        total_convertidos: totalConvertidos,
        faturamento_recuperado: parseFloat(faturamentoRecuperado.toFixed(2)),
        taxa_conversao: parseFloat(taxaConversao.toFixed(1)),
      },
      conversations: convList,
    });
  } catch (err: any) {
    console.error('Erro ao buscar conversas do Agente de IA:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
