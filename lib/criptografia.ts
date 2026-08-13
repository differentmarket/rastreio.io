import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.CPF_ENCRYPTION_KEY || 'default_secret_key_change_in_prod_123!';
  // Garante que a chave tenha exatamente 32 bytes (256 bits)
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Criptografa uma string usando AES-256-CBC.
 * Retorna um Buffer contendo o IV seguido do ciphertext.
 */
export function criptografar(texto: string): Buffer {
  if (!texto) return Buffer.alloc(0);
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

/**
 * Descriptografa um Buffer (IV + ciphertext) para a string original.
 */
export function descriptografar(buffer: Buffer | null | undefined): string {
  if (!buffer || buffer.length < IV_LENGTH + 1) return '';
  
  try {
    const key = getEncryptionKey();
    const iv = buffer.subarray(0, IV_LENGTH);
    const encryptedText = buffer.subarray(IV_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('Falha ao descriptografar dados:', err);
    return '';
  }
}

/**
 * Limpa o CPF (deixa apenas números) e gera o hash SHA-256 para indexação e busca rápida.
 */
export function gerarCpfHash(cpf: string): string {
  if (!cpf) return '';
  const cpfLimpo = cpf.replace(/\D/g, '');
  return crypto.createHash('sha256').update(cpfLimpo).digest('hex');
}

/**
 * Valida o formato básico de um CPF.
 */
export function validarCpf(cpf: string): boolean {
  const cleanCpf = cpf.replace(/\D/g, '');
  if (cleanCpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cleanCpf)) return false;
  
  // Algoritmo de verificação de dígitos do CPF
  let sum = 0;
  let remainder;
  for (let i = 1; i <= 9; i++) {
    sum += parseInt(cleanCpf.substring(i - 1, i)) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleanCpf.substring(9, 10))) return false;
  
  sum = 0;
  for (let i = 1; i <= 10; i++) {
    sum += parseInt(cleanCpf.substring(i - 1, i)) * (12 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleanCpf.substring(10, 11))) return false;
  
  return true;
}
