import { describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { COROS_READ_TOOLS, call_coros_read_tool, is_read_tool } from '@/lib/coros/mcp-client';

describe('COROS read-only allowlist', () => {
  it('contains no write tools', () => {
    for (const name of COROS_READ_TOOLS) expect(name).toMatch(/^(query|get)/);
  });

  it('rejects write tools by name', () => {
    for (const name of ['createTrainingPlan', 'updateTrainingPlan', 'createScheduledWorkout', 'scheduleWorkout', 'downloadActivityFitFiles']) {
      expect(is_read_tool(name)).toBe(false);
    }
  });

  it('refuses a disallowed tool before calling the server', async () => {
    let called = false;
    const client = { callTool: async () => { called = true; return { content: [] }; } } as unknown as Client;
    await expect(call_coros_read_tool(client, 'createScheduledWorkout', {})).rejects.toThrow(/not allowed/);
    expect(called).toBe(false);
  });

  it('passes an allowed tool through', async () => {
    const client = { callTool: async (req: { name: string }) => ({ content: [{ type: 'text', text: req.name }] }) } as unknown as Client;
    const result = await call_coros_read_tool(client, 'querySleepOverview', {});
    expect(result.content[0]).toEqual({ type: 'text', text: 'querySleepOverview' });
  });
});

describe('coros_origin', () => {
  it('pins production to its fixed domain so the cron finds the connection', async () => {
    const { coros_origin } = await import('@/lib/coros/mcp-client');
    const env = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: '8i11.vercel.app' };
    expect(coros_origin('https://8i11-abc123-team.vercel.app', env)).toBe('https://8i11.vercel.app');
    expect(coros_origin('https://8i11.vercel.app', env)).toBe('https://8i11.vercel.app');
  });

  it('keeps a preview on its own URL', async () => {
    const { coros_origin } = await import('@/lib/coros/mcp-client');
    expect(coros_origin('https://8i11-git-x-team.vercel.app', { VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: '8i11.vercel.app' }))
      .toBe('https://8i11-git-x-team.vercel.app');
    expect(coros_origin('http://localhost:3000', {})).toBe('http://localhost:3000');
  });
});
