import { z } from 'zod';
import { emailSchema } from '@/lib/auth/profile';
import { supabaseServer } from '@/lib/auth/supabase';
import { config } from '@/lib/config';
import { api, clientIp, parseBody } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

/** Request a password-reset email. Always answers the same way, whether or not the email exists. */
export const POST = api(async (req) => {
  await limitFor('passwordReset', `ip:${clientIp(req)}`);
  const { email } = await parseBody(req, z.object({ email: emailSchema }));
  if (config.mode === 'dev-local') {
    // No email service in dev-local mode; see README "Resetting a local password".
    return { ok: true, emailSent: false };
  }
  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${config.siteUrl}/auth/callback?next=/reset-password/update`,
  });
  return { ok: true, emailSent: true };
});
