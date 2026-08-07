import { Resend } from 'resend';
import { supabaseAdmin } from './supabaseAdmin';

export interface SendTrackingEmailParams {
  toEmail: string;
  toName: string;
  numeroPedido: string;
  codigoRastreio: string;
  trackingUrl: string;
}

function buildTrackingEmailHtml(params: SendTrackingEmailParams): string {
  const { toName, numeroPedido, codigoRastreio, trackingUrl } = params;
  const firstName = toName.split(' ')[0];

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Seu pedido foi enviado!</title>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:16px;padding:12px 28px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:1px;">📦 Rastreio de Pedido</span>
              </div>
            </td>
          </tr>

          <!-- Card principal -->
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:20px;border:1px solid #334155;overflow:hidden;">
                
                <!-- Top accent bar -->
                <tr>
                  <td style="background:linear-gradient(90deg,#6366f1,#8b5cf6,#06b6d4);height:4px;"></td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:40px 36px;">

                    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">${firstName}</strong> 👋</p>
                    <h1 style="color:#f1f5f9;font-size:26px;font-weight:700;margin:0 0 8px;line-height:1.3;">
                      Seu pedido está a caminho!
                    </h1>
                    <p style="color:#64748b;font-size:14px;margin:0 0 32px;">
                      O pedido <strong style="color:#94a3b8;">#${numeroPedido}</strong> foi enviado e já pode ser rastreado.
                    </p>

                    <!-- Tracking code box -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;border-radius:14px;border:1px solid #334155;margin-bottom:28px;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Código de Rastreio</p>
                          <p style="color:#818cf8;font-size:22px;font-weight:800;font-family:'Courier New',monospace;margin:0;letter-spacing:2px;">${codigoRastreio}</p>
                        </td>
                      </tr>
                    </table>

                    <!-- CTA Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                      <tr>
                        <td align="center">
                          <a href="${trackingUrl}"
                            style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:16px 40px;border-radius:12px;letter-spacing:0.5px;">
                            🔍 Rastrear meu pedido
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="color:#475569;font-size:12px;text-align:center;margin:0;">
                      Ou acesse diretamente:<br/>
                      <a href="${trackingUrl}" style="color:#6366f1;word-break:break-all;">${trackingUrl}</a>
                    </p>

                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding:0 36px;">
                    <div style="border-top:1px solid #1e293b;"></div>
                  </td>
                </tr>

                <!-- Footer note -->
                <tr>
                  <td style="padding:24px 36px;">
                    <p style="color:#475569;font-size:12px;margin:0;text-align:center;line-height:1.6;">
                      Caso tenha dúvidas, entre em contato conosco respondendo este e-mail.<br/>
                      <span style="color:#334155;">Obrigado por comprar conosco! 🙏</span>
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="color:#334155;font-size:11px;margin:0;">
                Este e-mail foi enviado automaticamente. Não responda caso não reconheça este pedido.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendTrackingEmail(params: SendTrackingEmailParams): Promise<{ success: boolean; error?: string }> {
  let apiKey = process.env.RESEND_API_KEY;
  let fromEmail = process.env.RESEND_FROM_EMAIL || 'Rastreio <noreply@seudominio.com>';

  // Tenta carregar chaves salvas dinamicamente no banco
  try {
    const { data: dbSettings } = await supabaseAdmin
      .from('settings')
      .select('key, value');

    if (dbSettings) {
      dbSettings.forEach((setting) => {
        if (setting.key === 'RESEND_API_KEY' && setting.value) {
          apiKey = setting.value;
        }
        if (setting.key === 'RESEND_FROM_EMAIL' && setting.value) {
          fromEmail = setting.value;
        }
      });
    }
  } catch (err) {
    console.warn('Erro ao ler chaves de e-mail do Supabase:', err);
  }

  // Modo mock/desenvolvimento — apenas loga no console se não tiver API key
  if (!apiKey || apiKey === 'mock-resend-key') {
    console.log('[EMAIL MOCK] Envio simulado de rastreio:');
    console.log(`  Para: ${params.toEmail} (${params.toName})`);
    console.log(`  Pedido: #${params.numeroPedido}`);
    console.log(`  Rastreio: ${params.codigoRastreio}`);
    console.log(`  Link: ${params.trackingUrl}`);
    return { success: true };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: [params.toEmail],
      subject: `📦 Pedido #${params.numeroPedido} enviado — Rastreie sua encomenda`,
      html: buildTrackingEmailHtml(params),
    });

    if (error) {
      console.error('[EMAIL] Erro ao enviar via Resend:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('[EMAIL] Exceção ao enviar e-mail:', err);
    return { success: false, error: err.message || 'Erro desconhecido ao enviar e-mail.' };
  }
}
