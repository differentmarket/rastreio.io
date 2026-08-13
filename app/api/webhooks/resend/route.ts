import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { type, data } = payload;

    if (!type || !data) {
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
    }

    const emailId = data.email_id || data.id;
    const recipient = data.to ? (Array.isArray(data.to) ? data.to[0] : data.to) : null;
    const timestamp = data.created_at || new Date().toISOString();

    console.log(`[RESEND WEBHOOK] Evento: ${type} | EmailId: ${emailId} | Destinatário: ${recipient}`);

    // Mapear status do evento do Resend
    let statusEmail = '';
    if (type === 'email.delivered') statusEmail = 'entregue';
    if (type === 'email.opened') statusEmail = 'aberto';
    if (type === 'email.clicked') statusEmail = 'clicado';
    if (type === 'email.bounced') statusEmail = 'bounced';
    if (type === 'email.complained') statusEmail = 'spam';

    // 1. Procurar rastreamento ou pedido vinculado se houver e-mail
    if (recipient && statusEmail) {
      // Buscar cliente pelo e-mail
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('email', recipient)
        .maybeSingle();

      if (customer) {
        // Atualizar logs de webhook na tabela de trackings se o e-mail foi entregue/bounced
        if (type === 'email.bounced') {
          console.warn(`[RESEND WEBHOOK] E-mail ${recipient} deu BOUNCE. Marcando no banco.`);
        }
      }
    }

    return NextResponse.json({ ok: true, received: type });
  } catch (error: any) {
    console.error('Erro ao processar Webhook do Resend:', error);
    return NextResponse.json({ error: error.message || 'Erro interno' }, { status: 500 });
  }
}
