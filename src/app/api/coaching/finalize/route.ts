/**
 * API route: POST /api/coaching/finalize
 * Saves the coaching session with a structured review (summary, facts
 * learned, decisions, developer notes) and the profile edits the coach
 * proposes, which Bill accepts or rejects. Also stores daily metrics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/models';
import { get_client } from '@/lib/db';
import { save_coaching_session, populate_daily_metrics, type InjectMetrics } from '@/lib/coaching/db';
import { get_memory_document, save_profile_proposals, type ProfileProposal } from '@/lib/coaching/memory';
import { REVIEW_SCHEMA, review_prompt, validate_review, type SessionReview } from '@/lib/coaching/session-review';
import { epoch_day_to_date_str } from '@/lib/coaching/day';

/**
 * Ask the small model for the structured review. Null when there is no API
 * key, the call fails, or the output does not validate: then the session is
 * saved without a summary or review, never with a half-checked one.
 */
async function review_session(conversation: string, profile: string | null): Promise<SessionReview | null> {
  const api_key = process.env.ANTHROPIC_API_KEY;
  if (!api_key) return null;

  try {
    const client = new Anthropic({ apiKey: api_key });
    const response = await client.messages.create({
      model: MODELS.COACHING_REFINE,
      max_tokens: 2000,
      output_config: { format: { type: 'json_schema', schema: REVIEW_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: review_prompt(conversation, profile) }],
    });
    if (response.stop_reason !== 'end_turn') return null;
    const text = response.content.find(b => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    return validate_review(JSON.parse(text.text), profile);
  } catch (err) {
    console.error('Session review failed:', err);
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

    const db = get_client();
    const profile = (await get_memory_document(db, 'profile').catch(() => null))?.body ?? null;
    const [review] = await Promise.all([
      review_session(advice_full, profile),
      date_str ? populate_daily_metrics(date_str, date, manual, inject_metrics) : Promise.resolve(),
    ]);

    // Prepend data snapshot to full advice if provided
    const full_with_context = data_snapshot
      ? `[Data for this session]\n${data_snapshot}\n\n[Conversation]\n${advice_full}`
      : advice_full;

    await save_coaching_session({
      date,
      advice_full: full_with_context,
      advice_summary: review?.summary ?? null,
      summary_json: review ? JSON.stringify(review) : null,
      conversation_turns,
      token_count,
    });

    // Proposals only change the profile once Bill accepts them on the page
    let proposals: ProfileProposal[] = [];
    if (review) {
      proposals = await save_profile_proposals(db, date_str || epoch_day_to_date_str(date), review.profile_edits)
        .catch(err => { console.error('Saving profile proposals failed:', err); return []; });
    }

    return NextResponse.json({ ok: true, summary: review?.summary ?? null, proposals });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Finalize failed' },
      { status: 500 }
    );
  }
}
