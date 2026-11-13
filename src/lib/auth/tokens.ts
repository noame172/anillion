import { SignJWT, jwtVerify } from 'jose';
import { config } from '@/lib/config';

export type TokenKind = 'user' | 'guest';

/** Signed, tamper-proof identity token stored in an httpOnly cookie. */
export async function signToken(kind: TokenKind, subject: string, days: number): Promise<string> {
  return new SignJWT({ k: kind })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(config.sessionSecret());
}

/** Returns the subject id, or null for anything missing, expired, forged or of the wrong kind. */
export async function verifyToken(token: string | undefined, kind: TokenKind): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, config.sessionSecret(), { algorithms: ['HS256'] });
    if (payload.k !== kind || typeof payload.sub !== 'string') return null;
    return /^[0-9a-f-]{36}$/i.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}
