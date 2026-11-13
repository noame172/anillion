import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { config } from '@/lib/config';

/** Supabase client bound to the request cookies. Uses the public anon key only. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. The middleware refreshes them.
        }
      },
    },
  });
}
