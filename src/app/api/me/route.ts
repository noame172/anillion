import { getUserViewer } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { api } from '@/lib/security/http';

export const dynamic = 'force-dynamic';

/** Who is signed in, for the header. Does not create a guest identity. */
export const GET = api(async () => {
  const user = await getUserViewer();
  return {
    user: user ? { username: user.username, role: user.role } : null,
    mode: config.mode,
  };
});
