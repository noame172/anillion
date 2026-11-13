import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/auth/supabase';
import { config } from '@/lib/config';
import { clientIp } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * Start "Continue with Google". Supabase Auth runs the OAuth exchange and
 * sends the player back to /auth/callback, which creates the profile and
 * merges any guest game. Needs the Google provider enabled in Supabase.
 */
export async function GET(req: NextRequest) {
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, config.siteUrl));
  if (config.mode !== 'supabase') return fail('google-off');
  try {
    await limitFor('loginIp', clientIp(req));
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${config.siteUrl}/auth/callback` },
    });
    if (error || !data.url) return fail('google');
    return NextResponse.redirect(data.url);
  } catch {
    return fail('google');
  }
}
