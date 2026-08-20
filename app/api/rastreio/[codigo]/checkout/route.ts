import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  try {
    const { codigo } = await params;
    const body = await req.json();
    const { name, email, document, bradesco_seguros, entrega_express } = body;

    if (!codigo) {
      return NextResponse.json({ error: 'Código de rastreio inválido.' }, { status: 400 });
    }

    // Buscar o rastreamento e a loja associada
    const { data: tracking, error: trackErr } = await supabaseAdmin
      .from('trackings')
      .select('id, codigo_rastreio, store_id')
      .eq('codigo_rastreio', codigo.toUpperCase().trim())
      .maybeSingle();

    if (trackErr || !tracking) {
      return NextResponse.json({ error: 'Código de rastreio não encontrado.' }, { status: 404 });
    }

    const { data: store, error: storeErr } = await supabaseAdmin
      .from('stores')
      .select('*')
      .eq('id', tracking.store_id)
      .maybeSingle();

    if (storeErr || !store) {
      return NextResponse.json({ error: 'Loja associada não encontrada.' }, { status: 404 });
    }

    // Buscar o CPF real descriptografado do cliente associado se o documento fornecido for mascarado ou incompleto
    let realDocument = document ? document.replace(/\D/g, '') : '';
    if (!realDocument || realDocument.includes('*') || realDocument.length < 11) {
      const { data: ord } = await supabaseAdmin
        .from('trackings')
        .select('orders ( customer_id )')
        .eq('id', tracking.id)
        .maybeSingle();

      const customerId = (ord?.orders as any)?.customer_id;
      if (customerId) {
        const { data: customer } = await supabaseAdmin
          .from('customers')
          .select('cpf_encrypted')
          .eq('id', customerId)
          .maybeSingle();

        if (customer && customer.cpf_encrypted) {
          try {
            let bufferCpf: Buffer;
            if (typeof customer.cpf_encrypted === 'string') {
              const hex = customer.cpf_encrypted.startsWith('\\x') 
                ? customer.cpf_encrypted.substring(2) 
                : customer.cpf_encrypted;
              bufferCpf = Buffer.from(hex, 'hex');
            } else {
              bufferCpf = Buffer.from(customer.cpf_encrypted);
            }
            const { descriptografar } = require('@/lib/criptografia');
            const decryptedCpf = descriptografar(bufferCpf);
            if (decryptedCpf) {
              realDocument = decryptedCpf.replace(/\D/g, '');
            }
          } catch (errDec) {
            console.error('Erro ao descriptografar CPF do cliente no checkout:', errDec);
          }
        }
      }
    }

    if (!realDocument || realDocument.length < 11) {
      realDocument = '12345678909';
    }

    // Calcular o valor total com os order bumps selecionados
    const baseValor = parseFloat(store.taxa_valor || '27.90');
    let valorTotal = baseValor;

    if (bradesco_seguros) {
      valorTotal += 14.76;
    }
    if (entrega_express) {
      valorTotal += 9.91;
    }

    valorTotal = parseFloat(valorTotal.toFixed(2));

    const veopagEnabled = store.veopag_enabled;
    const clientId = store.veopag_client_id;
    const clientSecret = store.veopag_client_secret;

    // Se a integração da VeoPag não estiver ativa ou faltar credenciais, fazemos a simulação de sandbox/mock
    const isMock = !veopagEnabled || !clientId || !clientSecret;

    if (isMock) {
      // Simulação de Pix de Sandbox
      const mockTxId = `mock-tx-${tracking.id}-${Date.now()}`;
      const mockQrcode = `00020126580014br.gov.bcb.pix0136mock-tx-${tracking.id}5204000053039865802BR5909SIMULADO6008SAOPAULO62070503***6304MOCK`;

      return NextResponse.json({
        success: true,
        isMock: true,
        transactionId: mockTxId,
        qrcode: mockQrcode,
        amount: valorTotal,
        external_id: `tracking_id:${tracking.id}:total:${valorTotal}`,
      });
    }

    // Realizar a integração real com a API da VeoPag
    // 1. Obter JWT Token
    const authRes = await fetch('https://api.veopag.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      }),
    });

    if (!authRes.ok) {
      const authErrText = await authRes.text();
      console.error('Erro de autenticação na VeoPag:', authErrText);
      return NextResponse.json({ error: 'Falha na autenticação com a adquirente.' }, { status: 502 });
    }

    const authData = await authRes.json();
    const veopagToken = authData.token;

    // Obter URL pública do app nas configurações da loja ou env
    const nextPublicAppUrl = store.next_public_app_url || process.env.NEXT_PUBLIC_APP_URL || 'https://rastreio-io.vercel.app';
    const callbackUrl = `${nextPublicAppUrl}/api/webhooks/veopag`;

    // 2. Gerar cobrança Pix
    const depositRes = await fetch('https://api.veopag.com/api/payments/deposit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${veopagToken}`,
      },
      body: JSON.stringify({
        amount: valorTotal,
        external_id: `tracking_id:${tracking.id}:total:${valorTotal}`,
        clientCallbackUrl: callbackUrl,
        payer: {
          name: name || 'Cliente Rastreio',
          email: email || 'noreply@pagamento.digital',
          document: realDocument,
        },
        platform: 'RASTREIO_IO',
      }),
    });

    if (!depositRes.ok) {
      const depErrText = await depositRes.text();
      console.error('Erro ao gerar depósito na VeoPag:', depErrText);
      return NextResponse.json({ error: 'Falha ao processar cobrança com a adquirente.' }, { status: 502 });
    }

    const depositData = await depositRes.json();
    console.log('Resposta completa da VeoPag:', JSON.stringify(depositData));

    // Extrair dados com suporte a múltiplos formatos retornados pela API
    const qrInfo = depositData.qrCodeResponse || depositData.data?.qrCodeResponse || depositData.data || depositData.pix || depositData.payment || depositData;

    const transactionId = qrInfo?.transactionId || qrInfo?.id || depositData?.transactionId || depositData?.id || `tx-${Date.now()}`;
    const qrcode = qrInfo?.qrcode || qrInfo?.qrCode || qrInfo?.emv || qrInfo?.payload || depositData?.qrcode || depositData?.qrCode || '';
    const amount = typeof qrInfo?.amount === 'number' ? qrInfo.amount : valorTotal;

    if (!qrcode) {
      console.error('Resposta da VeoPag sem QR Code válido:', depositData);
      const errMsg = depositData.message || depositData.error || depositData.msg || 'Falha ao obter QR Code da adquirente.';
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      transactionId,
      qrcode,
      amount,
      external_id: `tracking_id:${tracking.id}:total:${valorTotal}`,
    });
  } catch (err: any) {
    console.error('Erro no checkout da taxa:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
