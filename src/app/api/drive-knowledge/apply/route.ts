/**
 * API route: POST /api/drive-knowledge/apply
 * Writes an approved plan to Google Drive. Takes only a plan_id: the edits come
 * from the server-stored plan, never from the browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { claim_drive_plan } from '@/lib/db';
import { apply_plan, StoredPlan } from '@/lib/drive_filing';
import { GoogleNotConnectedError, require_owner } from '@/lib/google_auth';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth_error = await require_owner(request);
  if (auth_error) return auth_error;

  try {
    const { plan_id } = await request.json();
    if (!plan_id || typeof plan_id !== 'string') {
      return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });
    }

    // Claimed atomically, so a double-click or retry can't write twice.
    const plan = await claim_drive_plan(plan_id) as StoredPlan | null;
    if (!plan) {
      return NextResponse.json({ error: 'This preview has expired or was already used. Run Drive again.' }, { status: 410 });
    }

    const results = await apply_plan(plan);
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: error.message, not_connected: true }, { status: 409 });
    }
    console.error('Drive knowledge apply error:', error);
    return NextResponse.json({ error: 'Couldn\'t write to Drive' }, { status: 500 });
  }
}
