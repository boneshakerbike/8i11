/**
 * API route: POST /api/coaching/chat
 * Multi-turn coaching conversation. Optimized for 1-3 turns.
 * The system prompt is the coach's rules plus coach memory (framework, biomarker
 * targets, profile) and the last 7 sessions; the first message is the daily brief.
 * Every reply stays under 995 characters (src/lib/coaching/share-limit.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/models';
import { get_recent_sessions } from '@/lib/coaching/db';
import { get_client } from '@/lib/db';
import { get_coach_memory } from '@/lib/coaching/memory';
import { SESSION_MEMORY, build_coach_system } from '@/lib/coaching/coach-prompt';
import { normalizeCoachText } from '@/lib/coaching/normalize-text';
import { within_share_limit } from '@/lib/coaching/share-limit';
import { DECLINED_REPLY, reply_text } from '@/lib/coaching/reply';

/** One cheap rewrite when a reply runs over the share limit. */
async function shorten_reply(client: Anthropic, text: string): Promise<string> {
  const response = await client.messages.create({
    model: MODELS.COACHING_REFINE,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Rewrite this coaching reply in under 900 characters, spaces included. Keep today's prescription and any warning. Same voice, no preamble, no em dashes.\n\n${text}`,
    }],
  });
  const content = response.content[0];
  return content.type === 'text' ? normalizeCoachText(content.text) : text;
}

// A reply plus, rarely, one shortening rewrite
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_TURNS = 5;

/** The coach's rules plus coach memory and recent sessions. Falls back to the rules alone if memory can't be read. */
async function coach_system(): Promise<string> {
  const [memory, sessions] = await Promise.all([
    get_coach_memory(get_client()).catch(err => {
      console.error('Coach memory unavailable:', err);
      return { framework: null, crosswalk: null, profile: null };
    }),
    get_recent_sessions(SESSION_MEMORY).catch(() => []),
  ]);
  return build_coach_system(memory, sessions);
}

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const api_key = process.env.ANTHROPIC_API_KEY;
  if (!api_key) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { conversation_history, user_message } = body as {
      conversation_history: ChatMessage[];
      user_message: string;
    };

    if (!user_message || typeof user_message !== 'string') {
      return NextResponse.json({ error: 'user_message is required' }, { status: 400 });
    }

    const history = Array.isArray(conversation_history) ? conversation_history : [];
    const turn_number = Math.floor(history.length / 2) + 1;

    if (history.length >= MAX_TURNS * 2) {
      return NextResponse.json(
        { error: 'Maximum conversation length reached. Please save your session.' },
        { status: 400 }
      );
    }

    // Turn-aware hint, kept out of the cached block so every turn reuses the cache
    let turn_hint = '';
    if (turn_number === 2) {
      turn_hint = '(This is turn 2. The user is clarifying. Be direct and wrap up unless they have more.)';
    } else if (turn_number >= 3) {
      turn_hint = '(This is turn 3+. Wrap up concisely. One last thing if important, then done.)';
    }

    // Rules + framework + profile + recent sessions: the same for every turn of a session
    const system_blocks: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: await coach_system(), cache_control: { type: 'ephemeral' } },
    ];
    if (turn_hint) system_blocks.push({ type: 'text', text: turn_hint });

    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: user_message },
    ];

    const client = new Anthropic({ apiKey: api_key });

    const response = await client.beta.messages.create({
      model: MODELS.COACHING_DAILY,
      // Room for the model's thinking as well as the short reply
      max_tokens: 8000,
      // Opus 5.5 always thinks; low effort keeps replies quick and cheap
      output_config: { effort: 'low' },
      // A mistaken safety decline is re-run on Anthropic's recommended fallback model
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: system_blocks,
      messages,
    });

    const text = response.stop_reason === 'refusal' ? DECLINED_REPLY : reply_text(response.content);
    if (!text) throw new Error(`The coach returned no reply (stop reason: ${response.stop_reason})`);

    const reply = await within_share_limit(normalizeCoachText(text), t => shorten_reply(client, t));

    return NextResponse.json({
      response: reply,
      turn: turn_number,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Chat failed' },
      { status: 500 }
    );
  }
}
