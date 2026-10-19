import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from './config';

/** AES-256-GCM with APP_SECRET_KEY. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
function key(): Buffer {
  const k = Buffer.from(config.secretKey, 'base64');
  if (k.length !== 32) throw new Error('APP_SECRET_KEY is missing or not 32 bytes (base64)');
  return k;
}
export const secretsConfigured = () => { try { key(); return true; } catch { return false; } };

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(enc: string): string {
  const [v, iv, tag, ct] = enc.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
