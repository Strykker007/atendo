import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, verifyTotp } from '../src/modules/partners/totp';

describe('totp', () => {
  // vetores do RFC 6238 (SHA1, segredo "12345678901234567890")
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('base32 ida e volta', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('bate com os vetores do RFC', () => {
    const s = base32Decode(secret);
    expect(hotp(s, Math.floor(59 / 30))).toBe('287082');
    expect(hotp(s, Math.floor(1111111109 / 30))).toBe('081804');
    expect(hotp(s, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('aceita um passo de tolerância e recusa fora dela', () => {
    const now = 1111111109_000;
    expect(verifyTotp(secret, '081804', now)).toBe(Math.floor(1111111109 / 30));
    expect(verifyTotp(secret, '081804', now + 30_000)).not.toBeNull();
    expect(verifyTotp(secret, '081804', now + 90_000)).toBeNull();
    expect(verifyTotp(secret, '000000', now)).toBeNull();
    expect(verifyTotp(secret, '12', now)).toBeNull();
  });
});
