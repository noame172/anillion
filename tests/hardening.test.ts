import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { sslFor } from '@/lib/db/pg';
import { clientIp, parseBody } from '@/lib/security/http';
import { z } from 'zod';

const req = (headers: Record<string, string>, body?: string) =>
  new NextRequest('http://localhost/x', { method: 'POST', headers, body });

describe('clientIp', () => {
  it('ignores the part of X-Forwarded-For the client chose', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }))).toBe('9.9.9.9');
  });
  it('prefers the Vercel header', () => {
    expect(clientIp(req({ 'x-vercel-forwarded-for': '5.5.5.5', 'x-forwarded-for': '1.1.1.1' }))).toBe('5.5.5.5');
  });
  it('falls back to x-real-ip, then a shared key', () => {
    expect(clientIp(req({ 'x-real-ip': '7.7.7.7' }))).toBe('7.7.7.7');
    expect(clientIp(req({}))).toBe('local');
  });
});

describe('database TLS', () => {
  const url = 'postgresql://u:p@db.example.supabase.co:5432/postgres';
  it('is off only for a local host, judged by the host and not by the whole string', () => {
    expect(sslFor('postgresql://u:p@localhost:5432/db', {})).toBeUndefined();
    expect(sslFor('postgresql://u:pw-localhost@db.example.supabase.co:5432/db', {})).toEqual({ rejectUnauthorized: false });
  });
  it('verifies the server when a CA certificate is supplied', () => {
    const pem = '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----';
    const ssl = sslFor(url, { DATABASE_SSL_CA: pem });
    expect(ssl).toMatchObject({ rejectUnauthorized: true });
    expect((ssl as { ca: string }).ca).toContain('\n');
  });
});

describe('request size', () => {
  it('rejects an oversized body by its declared length', async () => {
    const r = req({ 'content-length': '50000', 'content-type': 'application/json' }, '{}');
    await expect(parseBody(r, z.object({}))).rejects.toMatchObject({ status: 413 });
  });
});
