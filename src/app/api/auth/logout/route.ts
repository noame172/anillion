import { supabaseServer } from '@/lib/auth/supabase';
import { clearLocalSession } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { api } from '@/lib/security/http';

export const dynamic = 'force-dynamic';

export const POST = api(async () => {
  if (config.mode === 'supabase') await (await supabaseServer()).auth.signOut();
  else await clearLocalSession();
  return { ok: true };
});
