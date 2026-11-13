import { NextRequest, NextResponse } from 'next/server';
import { ensureProfile } from '@/lib/auth/profile';
import { supabaseServer } from '@/lib/auth/supabase';
import { readGuestId } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { mergeGuestIntoUser } from '@/lib/game/merge';

export const dynamic = 'force-dynamic';

const EMAIL_TYPES = ['signup', 'email', 'recovery', 'invite', 'magiclink', 'email_change'] as const;

/**
 * Landing point for Supabase sign-in redirects.
 * - Google sign-in arrives with `code` (PKCE, same browser that started it).
 * - Email links arrive with `token_hash` + `type`, which work in any browser
 *   (see the README for the email template), or with `code` as a fallback.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const nextParam = req.nextUrl.searchParams.get('next') ?? '/';
  // Only same-site relative paths, so the link cannot be used as an open redirect.
  const next = /^\/(?!\/)[\w\-/]*$/.test(nextParam) ? nextParam : '/';

  const tokenHash = req.nextUrl.searchParams.get('token_hash');
  const typeParam = req.nextUrl.searchParams.get('type');
  const type = EMAIL_TYPES.find((t) => t === typeParam);

  if (config.mode === 'supabase' && (code || (tokenHash && type))) {
    try {
      const supabase = await supabaseServer();
      const { data, error } =
        tokenHash && type
          ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
          : await supabase.auth.exchangeCodeForSession(code!);
      if (!error && data.user) {
        await ensureProfile(data.user.id, data.user.email, data.user.user_metadata?.username, Boolean(data.user.email_confirmed_at));
        const guestId = await readGuestId();
        if (guestId) await mergeGuestIntoUser(guestId, data.user.id);
        return NextResponse.redirect(new URL(next, config.siteUrl));
      }
    } catch (err) {
      console.error('[auth/callback]', err);
    }
  }
  return NextResponse.redirect(new URL('/login?error=link', config.siteUrl));
}
