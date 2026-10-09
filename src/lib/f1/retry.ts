/**
 * Retry for transient Turso connection drops (ECONNRESET / "socket hang up").
 * Only read-only and schema statements are retried, so a write that reached
 * the database before the connection dropped is never applied twice.
 */

import type { Client, InStatement, TransactionMode } from '@libsql/client';

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET',
]);
const TRANSIENT_MESSAGE = /socket hang up|fetch failed|network|ECONNRESET/i;
const SAFE_SQL = /^\s*(SELECT|WITH|PRAGMA|CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX)\s+IF\s+NOT\s+EXISTS)\b/i;
const RETRY_DELAYS_MS = [100, 300];

export function is_transient_error(err: unknown): boolean {
  // libsql wraps the fetch error, so walk the cause chain
  for (let e = err, depth = 0; e && depth < 5; depth++) {
    const { code, message, cause } = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
    if (typeof message === 'string' && TRANSIENT_MESSAGE.test(message)) return true;
    e = cause;
  }
  return false;
}

export function is_retry_safe_sql(sql: string): boolean {
  return SAFE_SQL.test(sql);
}

function sql_of(stmt: InStatement | string): string {
  return typeof stmt === 'string' ? stmt : stmt.sql;
}

export async function with_retry<T>(
  fn: () => Promise<T>,
  delays: number[] = RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delays.length || !is_transient_error(err)) throw err;
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
}

/** Patches execute/batch on the client so retry-safe statements survive a dropped connection. */
export function add_read_retry(client: Client, delays: number[] = RETRY_DELAYS_MS): Client {
  const execute = client.execute.bind(client);
  const batch = client.batch.bind(client);

  client.execute = ((stmt: InStatement | string, args?: unknown) => {
    const run = () => (args === undefined
      ? execute(stmt as InStatement)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : execute(stmt as string, args as any));
    return is_retry_safe_sql(sql_of(stmt)) ? with_retry(run, delays) : run();
  }) as Client['execute'];

  client.batch = ((stmts: Array<InStatement>, mode?: TransactionMode) => {
    const run = () => batch(stmts, mode);
    const safe = mode === 'read' || stmts.every(s => is_retry_safe_sql(sql_of(s)));
    return safe ? with_retry(run, delays) : run();
  }) as Client['batch'];

  return client;
}
