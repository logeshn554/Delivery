import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashOtpCode(code: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(code, salt, 32).toString('hex')}`;
}

export function verifyOtpCode(code: string, stored: string): boolean {
  if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(stored)) return false;
  const [salt, digest] = stored.split(':');
  return timingSafeEqual(scryptSync(code, salt, 32), Buffer.from(digest, 'hex'));
}
