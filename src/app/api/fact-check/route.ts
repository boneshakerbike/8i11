/**
 * API route: POST /api/fact-check
 * Checks the factual claims in rough text against the web (see MODELS.FACT_CHECK)
 * and returns the text with the verified fixes applied, plus what was checked.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/models';
import {
  apply_fixes,
  check_findings,
  fact_check_prompt,
  fact_check_tools,
  MAX_CONTINUATIONS,
  read_submission,
  seen_urls,
} from '@/lib/fact_check';

// Web searches plus a thinking model; Vercel Pro allows up to 300s.
export const maxDuration = 300;

const MAX_INPUT = 20000;
// Stop starting model requests in time to answer inside maxDuration
const DEADLINE_MS = 270_000;
const MIN_REQUEST_MS = 30_000;

async function require_auth(request: NextRequest): Promise<NextResponse | null> {
  const token = await getToken({ req: request });
  if (token) return null;

  const pin_header = request.headers.get('X-Guest-Pin');
  if (pin_header) {
    const valid_pins = (process.env.GUEST_PINS || process.env.GUEST_PIN || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);
    if (valid_pins.includes(pin_header)) return null;
  }

  return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const auth_error = await require_auth(request);
  if (auth_error) return auth_error;

  const api_key = process.env.ANTHROPIC_API_KEY;
  if (!api_key) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  try {
    const { content } = await request.json();
    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }
    if (content.length > MAX_INPUT) {
      return NextResponse.json(
        { error: `Content too large (max ${MAX_INPUT.toLocaleString()} characters).` },
        { status: 400 }
      );
    }

    const client = new Anthropic({ apiKey: api_key });
    const started = Date.now();
    const prompt: Anthropic.Beta.BetaMessageParam = { role: 'user', content: fact_check_prompt(content) };

    // Everything the model produced, across pause_turn continuations
    const produced: Anthropic.Beta.BetaContentBlock[] = [];
    let input_tokens = 0;
    let output_tokens = 0;
    let searches = 0;
    let stop_reason: Anthropic.Beta.BetaStopReason | null = null;

    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const remaining = DEADLINE_MS - (Date.now() - started);
      if (turn > 0 && remaining < MIN_REQUEST_MS) break;

      // A paused turn is resumed by sending its content back unchanged, with no new user message
      const messages: Anthropic.Beta.BetaMessageParam[] = produced.length > 0
        ? [prompt, { role: 'assistant', content: [...produced] }]
        : [prompt];

      const response = await client.beta.messages.create({
        model: MODELS.FACT_CHECK,
        // Room for thinking, search results and the findings
        max_tokens: 16000,
        // Opus 5.5 always thinks; medium effort balances care against time and cost
        output_config: { effort: 'medium' },
        // A mistaken safety decline is re-run on Anthropic's recommended fallback model
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        tools: fact_check_tools,
        messages,
      }, {
        timeout: remaining,
        // Never repeat paid searches behind the user's back
        maxRetries: 0,
      });

      produced.push(...response.content);
      input_tokens += response.usage.input_tokens;
      output_tokens += response.usage.output_tokens;
      searches += response.usage.server_tool_use?.web_search_requests ?? 0;
      stop_reason = response.stop_reason;
      if (stop_reason !== 'pause_turn') break;
    }

    if (stop_reason === 'refusal') {
      return NextResponse.json({ error: 'The fact check was declined for this text.' }, { status: 502 });
    }
    const submitted = stop_reason === 'max_tokens' ? null : read_submission(produced);
    if (!submitted) {
      return NextResponse.json({ error: 'The fact check didn\'t finish. Try again.' }, { status: 502 });
    }

    const { fixed, findings } = apply_fixes(content, check_findings(submitted, seen_urls(produced)));

    return NextResponse.json({
      success: true,
      fixed,
      findings,
      usage: { input_tokens, output_tokens, searches },
    });
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return NextResponse.json({ error: 'The fact check took too long. Try a shorter text.' }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('Fact check error:', message);
    return NextResponse.json({ error: message || 'Failed to fact check text' }, { status: 500 });
  }
}
