import crypto from 'node:crypto';
import QRCode from 'qrcode';

let ephemeralSigningKey: string | null = null;
function getFallbackSigningKey(): string {
  if (!ephemeralSigningKey) {
    ephemeralSigningKey =
      (typeof process !== 'undefined' && process.env?.SESSION_SECRET) ||
      crypto.randomBytes(32).toString('hex');
  }
  return ephemeralSigningKey;
}
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

export function generateSessionToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export interface ChallengePayload {
  sub: number;
  purpose: 'mfa_verify' | 'mfa_enroll';
  exp: number;
  nonce: string;
}

export function signChallengeToken(
  userId: number,
  purpose: 'mfa_verify' | 'mfa_enroll',
  ttlSeconds = 300,
  signingSecret?: string
): string {
  const key = signingSecret || getFallbackSigningKey();
  const payload: ChallengePayload = {
    sub: userId,
    purpose,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', key)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyChallengeToken(
  token: string,
  expectedPurpose: 'mfa_verify' | 'mfa_enroll',
  signingSecret?: string
): ChallengePayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const key = signingSecret || getFallbackSigningKey();
  const expectedSig = crypto
    .createHmac('sha256', key)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ChallengePayload;
    if (
      typeof parsed.sub !== 'number' ||
      parsed.purpose !== expectedPurpose ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return encodeBase32(crypto.randomBytes(20));
}

export function computeTotpAtStep(secret: string, step: number): string {
  const key = decodeBase32(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, '0');
}

export function verifyTotpCode(
  secret: string,
  code: string,
  lastUsedStep?: number | null
): { valid: boolean; step: number } {
  const normalized = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) {
    return { valid: false, step: -1 };
  }

  const currentStep = Math.floor(Date.now() / 1000 / 30);
  for (const offset of [-1, 0, 1]) {
    const candidateStep = currentStep + offset;
    if (lastUsedStep !== null && lastUsedStep !== undefined && candidateStep <= lastUsedStep) {
      continue;
    }
    const expected = computeTotpAtStep(secret, candidateStep);
    const a = Buffer.from(normalized, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valid: true, step: candidateStep };
    }
  }
  return { valid: false, step: -1 };
}

export function buildOtpAuthUri(secret: string, email: string, issuer = 'KSCAT-ERP'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

export async function generateQrDataUrl(otpAuthUri: string): Promise<string> {
  const svg = await QRCode.toString(otpAuthUri, {
    type: 'svg',
    width: 220,
    margin: 2,
    color: {
      dark: '#0F172A',
      light: '#FFFFFF',
    },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function generateRecoveryCodes(count = 8): {
  plainCodes: string[];
  hashedCodes: string[];
} {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plainCodes.push(formatted);
    hashedCodes.push(hashRecoveryCode(formatted));
  }
  return { plainCodes, hashedCodes };
}

export function hashRecoveryCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const salt = crypto.randomBytes(8).toString('hex');
  const digest = crypto.createHash('sha256').update(`${salt}:${normalized}`).digest('hex');
  return `rc:${salt}:${digest}`;
}

export function verifyRecoveryCode(code: string, storedHashes: string[]): number {
  const normalized = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized) return -1;
  for (let i = 0; i < storedHashes.length; i++) {
    const entry = storedHashes[i];
    const parts = entry.split(':');
    if (parts.length !== 3 || parts[0] !== 'rc') continue;
    const [, salt, expectedDigest] = parts;
    const actualDigest = crypto.createHash('sha256').update(`${salt}:${normalized}`).digest('hex');
    const a = Buffer.from(actualDigest, 'hex');
    const b = Buffer.from(expectedDigest, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return i;
    }
  }
  return -1;
}
