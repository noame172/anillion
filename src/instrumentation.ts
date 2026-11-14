/**
 * Runs once when the server starts. The database work lives in a Node-only file so
 * the edge build of this hook never tries to bundle the Postgres driver.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}
