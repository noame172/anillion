import { getDb } from '@/lib/db/client';

// Open the database now (and, in local development, create and fill it) so the first
// visitor does not wait for it. A failure is logged; the first request will retry.
void getDb().catch((err) => console.error('[startup] database is not ready:', err));
