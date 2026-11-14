/** Postgres error codes the app turns into friendly answers instead of a 500. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

type PgError = { code?: string; constraint?: string; detail?: string; message?: string };

/** The constraint (or message) of a unique violation, or null for any other error. */
export function uniqueViolation(err: unknown): string | null {
  const e = err as PgError | null;
  if (!e || e.code !== UNIQUE_VIOLATION) return null;
  return `${e.constraint ?? ''} ${e.detail ?? ''} ${e.message ?? ''}`.toLowerCase();
}

export function isForeignKeyViolation(err: unknown): boolean {
  return (err as PgError | null)?.code === FOREIGN_KEY_VIOLATION;
}
