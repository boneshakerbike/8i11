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
    const result = await call_coros_read_tool(client, 'querySleepData', {});
    expect(result.content[0]).toEqual({ type: 'text', text: 'querySleepData' });
  });
});
