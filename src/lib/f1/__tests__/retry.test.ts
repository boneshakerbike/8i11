/**
 * Turso retry tests
 * Spec: transient connection drops retry read-only statements; writes never retry.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Client } from '@libsql/client';
import { is_transient_error, is_retry_safe_sql, add_read_retry } from '../retry';

function reset_error() {
  return Object.assign(new Error('request to https://x.turso.io/v2/pipeline failed, reason: socket hang up'), {
    code: 'ECONNRESET',
  });
}

function fake_client(execute: ReturnType<typeof vi.fn>, batch = vi.fn()): Client {
  return { execute, batch } as unknown as Client;
}

describe('is_transient_error', () => {
  it('matches the ECONNRESET seen in production', () => {
    expect(is_transient_error(reset_error())).toBe(true);
  });

  it('matches a transient error wrapped as a cause', () => {
    expect(is_transient_error(new Error('LibsqlError', { cause: reset_error() }))).toBe(true);
  });

  it('ignores SQL errors', () => {
    expect(is_transient_error(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'))).toBe(false);
  });
});

describe('is_retry_safe_sql', () => {
  it('allows reads and schema setup', () => {
    expect(is_retry_safe_sql('  SELECT * FROM f1_predictions')).toBe(true);
    expect(is_retry_safe_sql('\n    CREATE TABLE IF NOT EXISTS f1_seasons (')).toBe(true);
  });

  it('rejects writes', () => {
    expect(is_retry_safe_sql('INSERT INTO f1_predictions VALUES (?)')).toBe(false);
    expect(is_retry_safe_sql('UPDATE f1_predictions SET is_locked = 1')).toBe(false);
    expect(is_retry_safe_sql('DELETE FROM f1_seasons')).toBe(false);
  });
});

describe('add_read_retry', () => {
  it('retries a SELECT after a connection reset', async () => {
    const execute = vi.fn().mockRejectedValueOnce(reset_error()).mockResolvedValueOnce({ rows: [1] });
    const client = add_read_retry(fake_client(execute), [0, 0]);
    await expect(client.execute({ sql: 'SELECT 1', args: [] })).resolves.toEqual({ rows: [1] });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured retries', async () => {
    const execute = vi.fn().mockRejectedValue(reset_error());
    const client = add_read_retry(fake_client(execute), [0, 0]);
    await expect(client.execute('SELECT 1')).rejects.toThrow('socket hang up');
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('never retries a write', async () => {
    const execute = vi.fn().mockRejectedValue(reset_error());
    const client = add_read_retry(fake_client(execute), [0, 0]);
    await expect(client.execute({ sql: 'INSERT INTO f1_predictions VALUES (?)', args: ['a'] })).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-transient errors', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('no such table'));
    const client = add_read_retry(fake_client(execute), [0, 0]);
    await expect(client.execute('SELECT 1')).rejects.toThrow('no such table');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry a write batch', async () => {
    const batch = vi.fn().mockRejectedValue(reset_error());
    const client = add_read_retry(fake_client(vi.fn(), batch), [0, 0]);
    await expect(client.batch([{ sql: 'DELETE FROM f1_seasons', args: [] }], 'write')).rejects.toThrow();
    expect(batch).toHaveBeenCalledTimes(1);
  });
});
