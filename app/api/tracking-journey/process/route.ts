import { NextRequest, NextResponse } from 'next/server';
import { processJourneyQueue } from '@/lib/trackingJourney';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tracking-journey/process
 *
 * Cron worker da jornada de rastreio de 15 dias.
 * Processa a fila tracking_journey_queue, enviando os e-mails de cada step no momento correto.
 *
 * Segurança: protegido por CRON_SECRET (header Authorization: Bearer <secret>)
 * Configurado no vercel.json para rodar a cada hora.
 */
export async function POST(req: NextRequest) {
  // Validação do secret do cron (mesma convenção usada em outros crons do projeto)
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    // Se CRON_SECRET está configurado, exige o header correto
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
  }

  console.log('[JOURNEY CRON] Iniciando processamento da fila...');

  try {
    const stats = await processJourneyQueue(50);

    return NextResponse.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[JOURNEY CRON] Erro crítico:', err);
    return NextResponse.json(
      { error: err.message || 'Erro interno no cron.' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tracking-journey/process
 * Alias GET para compatibilidade com invocação via browser/Vercel Cron HTTP GET
 */
export async function GET(req: NextRequest) {
  return POST(req);
}
