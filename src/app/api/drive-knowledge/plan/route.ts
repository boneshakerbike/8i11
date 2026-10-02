/**
 * API route: POST /api/drive-knowledge/plan
 * Works out where a knowledge doc belongs in the owner's Google Drive and what
 * is new, without writing anything. Returns a preview plus a plan_id; the edits
 * themselves stay server-side until /apply is called with that id.
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { save_drive_plan } from '@/lib/db';
import { plan_filing } from '@/lib/drive_filing';
import { GoogleNotConnectedError, require_owner } from '@/lib/google_auth';

// Indexing the Drive plus three model calls; Vercel Pro allows up to 300s.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth_error = await require_owner(request);
  if (auth_error) return auth_error;

  const api_key = process.env.ANTHROPIC_API_KEY;
  if (!api_key) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  try {
    const { content } = await request.json();
    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    if (content.length > 200000) {
      return NextResponse.json({ error: 'Document is too long to file' }, { status: 413 });
    }

    const result = await plan_filing(content, new Anthropic({ apiKey: api_key }));

    let plan_id: string | null = null;
    if (result.status === 'ready' && result.stored) {
      plan_id = crypto.randomUUID();
      await save_drive_plan(plan_id, result.stored);
    }

    return NextResponse.json({
      plan_id,
      status: result.status,
      reasoning: result.reasoning,
      edits: result.edits,
      rejected: result.rejected,
      suggested_folder: result.suggested_folder ?? null,
    });
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: error.message, not_connected: true }, { status: 409 });
    }
    console.error('Drive knowledge plan error:', error);
    const is_prod = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { error: is_prod ? 'Couldn\'t work out where this goes in Drive' : (error instanceof Error ? error.message : 'Plan failed') },
      { status: 500 }
    );
  }
}
