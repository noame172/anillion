import { NextRequest, NextResponse } from 'next/server';
import { ensureProfile } from '@/lib/auth/profile';
import { supabaseServer } from '@/lib/auth/supabase';
import { readGuestId } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { mergeGuestIntoUser } from '@/lib/game/merge';

export const dynamic = 'force-dynamic';

/** Landing point for Supabase email links (verification and password reset). */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const nextParam = req.nextUrl.searchParams.get('next') ?? '/';
  // Only same-site relative paths, so the link cannot be used as an open redirect.
  const next = /^\/(?!\/)[\w\-/]*$/.test(nextParam) ? nextParam : '/';

  if (config.mode === 'supabase' && code) {
    try {
      const supabase = await supabaseServer();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data.user) {
        await ensureProfile(data.user.id, data.user.email, data.user.user_metadata?.username);
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
