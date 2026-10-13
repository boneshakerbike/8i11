/**
 * API route: POST /api/coaching/finalize
 * Saves coaching session with auto-generated summary.
 * Stores: full conversation, summary, daily metrics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/models';
import { save_coaching_session, populate_daily_metrics, type InjectMetrics } from '@/lib/coaching/db';
import { normalizeCoachText } from '@/lib/coaching/normalize-text';
import { fit_to_limit } from '@/lib/coaching/share-limit';

async function generate_summary(conversation: string): Promise<string | null> {
  const api_key = process.env.ANTHROPIC_API_KEY;
  if (!api_key) return null;

  try {
    const client = new Anthropic({ apiKey: api_key });
    const response = await client.messages.create({
      model: MODELS.COACHING_REFINE,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Summarize this coaching session in 2-3 sentences, under 800 characters, spaces included. Focus on: what was the main advice, any flags raised, and what was prescribed for today. No preamble, no em dashes.\n\n${conversation}`,
      }],
    });
    const content = response.content[0];
    // Bill pastes the summary into the Oura app's AI chat, which takes 995 characters
    return content.type === 'text' ? fit_to_limit(normalizeCoachText(content.text)) : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { date, date_str, advice_full, conversation_turns, token_count, manual, data_snapshot, inject_metrics } = body as {
      date: number;
      date_str: string;
      advice_full: string;
      conversation_turns: number;
      token_count: number;
      manual?: { weight_lbs?: number; back_pain_scale?: number; back_mobility_notes?: string; bowel_status?: string; bowel_scale?: number; injury_notes?: string };
      data_snapshot?: string;
      inject_metrics?: InjectMetrics;
    };

    if (!date || !advice_full) {
      return NextResponse.json({ error: 'date and advice_full are required' }, { status: 400 });
    }

    // Generate summary and save in parallel
    const [summary] = await Promise.all([
      generate_summary(advice_full),
      date_str ? populate_daily_metrics(date_str, date, manual, inject_metrics) : Promise.resolve(),
    ]);

    // Prepend data snapshot to full advice if provided
    const full_with_context = data_snapshot
      ? `[Data for this session]\n${data_snapshot}\n\n[Conversation]\n${advice_full}`
      : advice_full;

    await save_coaching_session({
      date,
      advice_full: full_with_context,
      advice_summary: summary,
      conversation_turns,
      token_count,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Finalize failed' },
      { status: 500 }
    );
  }
}
