/**
 * Storage for the COROS MCP OAuth connection.
 *
 * One row per site origin. Each origin (production, a branch preview) registers
 * its own OAuth client with COROS because the callback URL differs, and they all
 * share one Turso database. Tokens never leave the server.
 */

import type { Client } from '@libsql/client';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

export interface CorosOAuthRecord {
  client_info: OAuthClientInformationMixed | null;
  tokens: OAuthTokens | null;
  code_verifier: string | null;
  discovery: OAuthDiscoveryState | null;
}

export type CorosOAuthField = 'client_info' | 'tokens' | 'code_verifier' | 'discovery';

// Fixed column names: field values are never interpolated from input.
const COLUMN: Record<CorosOAuthField, string> = {
  client_info: 'client_info_json',
  tokens: 'tokens_json',
  code_verifier: 'code_verifier',
  discovery: 'discovery_json',
};

const parse = <T>(v: unknown): T | null => (typeof v === 'string' && v ? JSON.parse(v) as T : null);

export function create_coros_store(db: Client) {
  let ready: Promise<void> | null = null;
  const ensure = (): Promise<void> => {
    ready ??= db.execute(`
      CREATE TABLE IF NOT EXISTS coros_oauth (
        origin TEXT PRIMARY KEY,
        client_info_json TEXT,
        tokens_json TEXT,
        code_verifier TEXT,
        discovery_json TEXT,
        updated_at INTEGER
      )
    `).then(() => undefined, err => { ready = null; throw err; });
    return ready;
  };

  async function get(origin: string): Promise<CorosOAuthRecord> {
    await ensure();
    const r = await db.execute({ sql: 'SELECT * FROM coros_oauth WHERE origin = ?', args: [origin] });
    const row = r.rows[0];
    return {
      client_info: parse(row?.client_info_json),
      tokens: parse(row?.tokens_json),
      code_verifier: (row?.code_verifier as string | null) ?? null,
      discovery: parse(row?.discovery_json),
    };
  }

  async function set(origin: string, field: CorosOAuthField, value: unknown): Promise<void> {
    await ensure();
    const col = COLUMN[field];
    const stored = value == null ? null : field === 'code_verifier' ? String(value) : JSON.stringify(value);
    await db.execute({
      sql: `INSERT INTO coros_oauth (origin, ${col}, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(origin) DO UPDATE SET ${col} = excluded.${col}, updated_at = excluded.updated_at`,
      args: [origin, stored, Math.floor(Date.now() / 1000)],
    });
  }

  async function clear(origin: string, fields: CorosOAuthField[]): Promise<void> {
    for (const f of fields) await set(origin, f, null);
  }

  async function remove(origin: string): Promise<boolean> {
    await ensure();
    const r = await db.execute({ sql: 'DELETE FROM coros_oauth WHERE origin = ?', args: [origin] });
    return r.rowsAffected > 0;
  }

  return { get, set, clear, remove };
}

export type CorosStore = ReturnType<typeof create_coros_store>;
