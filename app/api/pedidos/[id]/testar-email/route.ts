import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

// Rota de TESTE — ignora regras de duplicidade e timing
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const tipo: 'nota' | 'rastreio' | 'ambos' = body.tipo || 'ambos';
    const emailDestino: string | null = body.emailDestino || null;

    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(`
        id, numero_pedido, valor_total, itens, raw_payload, created_at, shopify_order_id,
        customers ( nome, email ),
        addresses ( logradouro, numero, complemento, bairro, cidade, estado, cep ),
        trackings ( id, codigo_rastreio, status, email_enviado )
      `)
      .eq('id', id)
      .single();

    if (error || !order) {
      return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    }

    const cust = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    const trk  = Array.isArray(order.trackings)  ? order.trackings[0]  : order.trackings;
    const addr = Array.isArray(order.addresses)  ? order.addresses[0]  : order.addresses;

    if (!cust?.email && !emailDestino) {
      return NextResponse.json({ error: 'Cliente sem e-mail cadastrado.' }, { status: 400 });
    }

    const { data: settings } = await supabaseAdmin.from('settings').select('key, value');
    const cfg: Record<string, string> = {};
    settings?.forEach(s => { cfg[s.key] = s.value; });

    const resendApiKey = cfg['RESEND_API_KEY'] || '';
    let fromEmail = cfg['RESEND_FROM_EMAIL'] || 'Rastreio <onboarding@resend.dev>';
    if (fromEmail.includes('seudominio.com')) {
      fromEmail = 'Rastreio <onboarding@resend.dev>';
    }
    let rawAppUrl = cfg['NEXT_PUBLIC_APP_URL'] || process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
    rawAppUrl = rawAppUrl.trim().replace(/\/+$/, '').replace(/\/rastreio$/, '');
    if (!rawAppUrl || rawAppUrl.includes('localhost') || rawAppUrl.includes('ri7o2sjad')) {
      rawAppUrl = 'https://rastreio-io.vercel.app';
    }
    const appUrl      = rawAppUrl;
    const empresaNome = cfg['EMPRESA_NOME'] || 'Nossa Loja';
    const toEmail     = emailDestino || cust?.email;

    const results: { tipo: string; sucesso: boolean; erro?: string }[] = [];

    // ── Nota de Compra ──────────────────────────────────────────
    if (tipo === 'nota' || tipo === 'ambos') {
      const htmlNota = buildNotaHtml({ order, cust, addr, cfg });

      if (!resendApiKey || resendApiKey === 'mock-resend-key') {
        console.log(`[TESTE NOTA MOCK] Para: ${toEmail}, Pedido: #${order.numero_pedido}`);
        results.push({ tipo: 'nota', sucesso: true });
      } else {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromEmail,
            to: toEmail,
            subject: `[TESTE] Comprovante de Compra — Pedido #${order.numero_pedido}`,
            html: htmlNota,
          }),
        });
        const rData = await r.json();
        if (!r.ok) {
          results.push({ tipo: 'nota', sucesso: false, erro: rData.message || JSON.stringify(rData) });
        } else {
          results.push({ tipo: 'nota', sucesso: true });
        }
      }
    }

    // ── Rastreio ────────────────────────────────────────────────
    if (tipo === 'rastreio' || tipo === 'ambos') {
      if (!trk?.codigo_rastreio) {
        results.push({ tipo: 'rastreio', sucesso: false, erro: 'Pedido sem código de rastreio.' });
      } else {
        const trackingUrl = `${appUrl}/rastreio/${trk.codigo_rastreio}`;
        const htmlRastreio = buildRastreioHtml({ order, cust, trk, trackingUrl, empresaNome });

        if (!resendApiKey || resendApiKey === 'mock-resend-key') {
          console.log(`[TESTE RASTREIO MOCK] Para: ${toEmail}, Código: ${trk.codigo_rastreio}`);
          results.push({ tipo: 'rastreio', sucesso: true });
        } else {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: fromEmail,
              to: toEmail,
              subject: `[TESTE] Pedido #${order.numero_pedido} — Código de Rastreio`,
              html: htmlRastreio,
            }),
          });
          const rData = await r.json();
          if (!r.ok) {
            results.push({ tipo: 'rastreio', sucesso: false, erro: rData.message || JSON.stringify(rData) });
          } else {
            results.push({ tipo: 'rastreio', sucesso: true });
          }
        }
      }
    }

    const todosOk = results.every(r => r.sucesso);
    return NextResponse.json({
      success: todosOk,
      results,
      emailDestino: toEmail,
      numeroPedido: order.numero_pedido,
      modoMock: !resendApiKey || resendApiKey === 'mock-resend-key',
    });

  } catch (err: any) {
    console.error('[TESTE EMAIL] Erro:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}

// ── Templates ──────────────────────────────────────────────────────
function buildNotaHtml({ order, cust, addr, cfg }: any) {
  const empresaNome = cfg['EMPRESA_NOME'] || 'Nossa Loja';
  const empresaCnpj = cfg['EMPRESA_CNPJ'] || '00.000.000/0001-00';
  const empresaEndereco = cfg['EMPRESA_ENDERECO'] || 'Rua Principal, 100';
  const empresaCidade = cfg['EMPRESA_CIDADE'] || 'São Paulo';
  const empresaEstado = cfg['EMPRESA_ESTADO'] || 'SP';
  const empresaCep = cfg['EMPRESA_CEP'] || '01000-000';

  const dataPedido = order.created_at 
    ? new Date(order.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleDateString('pt-BR');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<style>
  body { margin:0; padding:0; background:#f4f6f8; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color:#333; }
  .wrapper { width:100%; table-layout:fixed; background-color:#f4f6f8; padding:40px 0; }
  .content-table { width:600px; margin:0 auto; background:#ffffff; border-radius:8px; border:1px solid #e1e4e6; overflow:hidden; border-collapse:collapse; }
  .header { background:#0f172a; padding:30px 40px; color:#ffffff; }
  .header h1 { margin:0; font-size:22px; font-weight:700; letter-spacing:-0.5px; }
  .header p { margin:5px 0 0; font-size:12px; color:#94a3b8; }
  .section { padding:30px 40px; border-bottom:1px solid #f0f2f4; }
  .section-title { font-size:12px; font-weight:700; text-transform:uppercase; color:#64748b; letter-spacing:1px; margin-bottom:15px; }
  .grid-table { width:100%; border-collapse:collapse; }
  .grid-table td { padding:4px 0; font-size:13px; color:#475569; vertical-align:top; }
  .items-table { width:100%; border-collapse:collapse; margin-top:10px; }
  .items-table th { border-bottom:2px solid #e2e8f0; padding:10px 0; text-align:left; font-size:11px; text-transform:uppercase; color:#64748b; font-weight:700; }
  .items-table td { border-bottom:1px solid #f1f5f9; padding:12px 0; font-size:13px; color:#1e293b; }
  .total-row { padding-top:20px; font-size:16px; font-weight:700; color:#0f172a; text-align:right; }
  .footer { background:#fafbfc; padding:20px 40px; text-align:center; font-size:11px; color:#94a3b8; border-top:1px solid #f0f2f4; }
</style>
</head>
<body>
<table class="wrapper" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center">
<table class="content-table" width="600" cellpadding="0" cellspacing="0">
  
  <!-- Header -->
  <tr><td class="header">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <h1>COMPROVANTE DE VENDA</h1>
          <p>Pedido #${order.numero_pedido} &bull; ${dataPedido} &bull; [TESTE]</p>
        </td>
        <td align="right" style="font-size:14px; font-weight:bold; color:#38bdf8;">
          NÃO POSSUI VALOR FISCAL
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Dados do Emitente (Empresa) -->
  <tr><td class="section">
    <div class="section-title">Dados do Emitente</div>
    <table class="grid-table">
      <tr>
        <td style="font-weight:bold; color:#1e293b; font-size:14px;" colspan="2">${empresaNome}</td>
      </tr>
      <tr>
        <td width="50%"><strong>CNPJ:</strong> ${empresaCnpj}</td>
        <td width="50%"><strong>Endereço:</strong> ${empresaEndereco}</td>
      </tr>
      <tr>
        <td><strong>Cidade/UF:</strong> ${empresaCidade} - ${empresaEstado}</td>
        <td><strong>CEP:</strong> ${empresaCep}</td>
      </tr>
    </table>
  </td></tr>

  <!-- Dados do Destinatário (Cliente) -->
  <tr><td class="section">
    <div class="section-title">Dados do Destinatário</div>
    <table class="grid-table">
      <tr>
        <td width="50%"><strong>Nome:</strong> ${cust?.nome || 'Cliente'}</td>
        <td width="50%"><strong>E-mail:</strong> ${cust?.email || '—'}</td>
      </tr>
      ${addr ? `
      <tr>
        <td colspan="2"><strong>Endereço de Entrega:</strong> ${addr.logradouro || ''}, ${addr.numero || ''} ${addr.complemento || ''} - ${addr.bairro || ''} - ${addr.cidade || ''}/${addr.estado || ''} - CEP: ${addr.cep || ''}</td>
      </tr>
      ` : ''}
    </table>
  </td></tr>

  <!-- Detalhes do Pedido (Itens) -->
  <tr><td class="section">
    <div class="section-title">Itens do Pedido</div>
    <table class="items-table">
      <thead>
        <tr>
          <th width="65%">Produto</th>
          <th width="15%" style="text-align:center;">Qtd</th>
          <th width="20%" style="text-align:right;">Preço</th>
        </tr>
      </thead>
      <tbody>
        ${(order.itens || []).map((item: any) => `
        <tr>
          <td>
            <div style="font-weight:600; color:#0f172a;">${item.title}</div>
            ${item.sku ? `<div style="font-size:10px; color:#64748b; margin-top:2px;">SKU: ${item.sku}</div>` : ''}
          </td>
          <td style="text-align:center;">${item.quantity}</td>
          <td style="text-align:right; font-weight:500;">R$ ${parseFloat(item.price).toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    
    <div class="total-row">
      Total Geral: R$ ${(order.valor_total || 0).toFixed(2)}
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td class="footer">
    <p>Este documento é um comprovante de compra gerado de forma automática por Rastreio.IO.<br/>
    Dúvidas ou suporte? Entre em contato respondendo a este e-mail.</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function buildRastreioHtml({ order, cust, trk, trackingUrl, empresaNome }: any) {
  const firstName = (cust?.nome || 'Cliente').split(' ')[0];
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
<tr><td align="center">
<table width="600" style="max-width:600px;width:100%;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
  <tr><td style="background:linear-gradient(90deg,#6366f1,#8b5cf6);height:4px;"></td></tr>
  <tr><td style="padding:32px;">
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Olá, <strong style="color:#f1f5f9;">${firstName}</strong> 👋</p>
    <h1 style="color:#f1f5f9;font-size:24px;margin:0 0 8px;">Seu pedido está a caminho! 📦</h1>
    <p style="color:#64748b;font-size:13px;margin:0 0 28px;">Pedido <strong style="color:#94a3b8;">#${order.numero_pedido}</strong> [TESTE]</p>
    <div style="background:#0f172a;border-radius:12px;border:1px solid #334155;padding:18px 22px;margin-bottom:24px;">
      <p style="color:#64748b;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Código de Rastreio</p>
      <p style="color:#818cf8;font-size:22px;font-weight:800;font-family:'Courier New',monospace;margin:0;letter-spacing:2px;">${trk.codigo_rastreio}</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <a href="${trackingUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 36px;border-radius:10px;">
          🔍 Rastrear meu pedido
        </a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 32px;text-align:center;">
    <p style="color:#475569;font-size:11px;margin:0;">${empresaNome} · E-mail de teste</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
