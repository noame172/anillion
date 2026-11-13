import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError, badRequest } from '@/lib/errors';

const MAX_BODY_BYTES = 20_000;

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip') || 'local';
}

/**
 * CSRF guard for cookie-authenticated, state-changing requests: the browser's
 * Origin must be this site. Requests without an Origin (non-browser clients)
 * carry no ambient cookies worth protecting and are allowed through.
 */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError(403, 'BAD_ORIGIN', 'Cross-site request blocked.');
  }
  if (originHost !== host) throw new AppError(403, 'BAD_ORIGIN', 'Cross-site request blocked.');
}

/** Parse and validate a JSON body. Unknown fields are dropped, never trusted. */
export async function parseBody<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError(413, 'TOO_LARGE', 'Request is too large.');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('Request body must be JSON.');
  }
  return schema.parse(json);
}

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<unknown>;

/** Wraps a route handler: CSRF check, JSON output, and safe error responses. */
export function api(handler: Handler) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
      const out = await handler(req, ctx);
      if (out instanceof NextResponse) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      if (err instanceof AppError) {
        return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
      }
      if (err instanceof z.ZodError) {
        const message = err.issues[0]?.message ?? 'Invalid input.';
        return NextResponse.json({ error: { code: 'INVALID_INPUT', message } }, { status: 400 });
      }
      // Internal details (SQL, stack traces) stay in the server log.
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, err);
      return NextResponse.json(
        { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } },
        { status: 500 },
      );
    }
  };
}
