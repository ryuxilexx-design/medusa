import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'crypto';

/** scrypt parameters: N=2^15, r=8, p=1 (~32 MB, ~50–100 ms) — stored with the hash so they can be raised later. */
const N = 32768, R = 8, P = 1, KEYLEN = 64;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Constant-time verification. A malformed or missing hash never matches. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    await scrypt(password, randomBytes(16), N, R, P); // keep timing similar for unknown users
    return false;
  }
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Readable temporary password (no 0/O, 1/l/I), always with letters and digits. Shown once, must be changed at first login. */
export function generateTempPassword(length = 10): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz', digits = '23456789', all = letters + digits;
  for (;;) {
    let s = '';
    for (let i = 0; i < length; i++) s += all[randomInt(all.length)];
    if (/[a-z]/.test(s) && /\d/.test(s)) return s;
  }
}
