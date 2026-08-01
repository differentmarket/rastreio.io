import crypto from 'crypto';

export function verifyShopifyWebhook(rawBody: string, hmacHeader: string, secret: string): boolean {
  if (!secret) {
    console.error('Segredo de assinatura do webhook do Shopify não fornecido.');
    return false;
  }

  const generatedHash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedHash),
      Buffer.from(hmacHeader)
    );
  } catch (err) {
    return false;
  }
}
