import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enviarRastreioShopify } from '@/lib/shopifyService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // Em produção real, você pode adicionar uma validação de Authorization 
    // verificando se o header do CRON JOB bate com um segredo configurado (ex: Vercel Cron envia um header específico).
    // Para simplificar o teste livre, deixaremos aberto ou pode ser protegido no futuro.

    // Busca todos os rastreamentos não sincronizados cujo sync_after já passou
    const { data: trackings, error } = await supabaseAdmin
      .from('trackings')
      .select('id, codigo_rastreio, order_id, orders(shopify_order_id)')
      .eq('shopify_synced', false)
      .lte('sync_after', new Date().toISOString());

    if (error) {
      console.error('Erro ao buscar rastreamentos pendentes:', error);
      return NextResponse.json({ error: 'Erro ao buscar rastreamentos pendentes' }, { status: 500 });
    }

    if (!trackings || trackings.length === 0) {
      return NextResponse.json({ message: 'Nenhum rastreamento pendente de sincronização no momento.' });
    }

    const resultados = [];

    for (const tracking of trackings) {
      const shopifyOrderId = (tracking.orders as any)?.shopify_order_id;
      
      if (!shopifyOrderId) {
        console.warn(`Rastreamento ${tracking.codigo_rastreio} sem shopify_order_id. Pulando.`);
        continue;
      }

      try {
        await enviarRastreioShopify(shopifyOrderId, tracking.codigo_rastreio);
        
        // Atualiza a flag
        await supabaseAdmin
          .from('trackings')
          .update({ shopify_synced: true })
          .eq('id', tracking.id);
          
        resultados.push({ codigo: tracking.codigo_rastreio, status: 'sucesso' });
      } catch (err: any) {
        console.error(`Erro ao sincronizar rastreamento ${tracking.codigo_rastreio}:`, err);
        resultados.push({ codigo: tracking.codigo_rastreio, status: 'erro', erro: err.message });
      }
    }

    return NextResponse.json({ message: 'Processamento concluído', processados: trackings.length, resultados });
  } catch (err: any) {
    console.error('Erro geral no cron job:', err);
    return NextResponse.json({ error: 'Erro Interno' }, { status: 500 });
  }
}
