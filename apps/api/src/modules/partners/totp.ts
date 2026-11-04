import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238: HMAC-SHA1, 6 dígitos, passo de 30 s) — o mesmo do Google Authenticator,
 * Authy, 1Password. Puro, sem dependência: é a trava dos pagamentos a parceiros
 * (docs/37-vogopartners.md#segurança).
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_S = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** Segredo novo (160 bits), em base32 — é o que a pessoa digita ou lê no app autenticador. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_S);

/**
 * Confere o código aceitando um passo antes/depois (relógio do celular adiantado/atrasado).
 * Devolve o passo que bateu (para impedir reuso do mesmo código) ou null.
 */
export function verifyTotp(secretB32: string, code: string, now = Date.now(), window = 1): number | null {
  const c = code.replace(/\D/g, '');
  if (c.length !== 6) return null;
  const secret = base32Decode(secretB32);
  const step = totpStep(now);
  for (let d = -window; d <= window; d++) {
    const expected = Buffer.from(hotp(secret, step + d));
    if (timingSafeEqual(expected, Buffer.from(c))) return step + d;
  }
  return null;
}

/** Link `otpauth://` — vira QR Code em qualquer gerador, ou o app abre direto no celular. */
export const otpauthUrl = (secretB32: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_S}`;
