import crypto from 'crypto';

/**
 * Gera um código de rastreio próprio no formato:
 * BR + AAMM + 6 caracteres alfanuméricos aleatórios (hash)
 * Exemplo: BR2607A3F9K1
 */
export function gerarCodigoRastreio(orderId: string): string {
  const data = new Date();
  const ano = String(data.getFullYear()).slice(2);
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const prefixo = `BR${ano}${mes}`;

  const hash = crypto
    .createHash('sha256')
    .update(orderId + Date.now().toString() + Math.random().toString())
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();

  return `${prefixo}${hash}`;
}
