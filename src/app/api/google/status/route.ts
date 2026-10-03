/**
 * API route: GET /api/google/status
 * Whether this session may use Drive (owner only) and whether Drive is connected
 */

import { NextRequest, NextResponse } from 'next/server';
import { get_google_tokens } from '@/lib/db';
import { is_owner_request } from '@/lib/google_auth';

export async function GET(request: NextRequest) {
  // Guests get a plain "not for you" so the page can hide the button entirely.
  if (!(await is_owner_request(request))) {
    return NextResponse.json({ owner: false, connected: false });
  }

  try {
    const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
    const tokens = await get_google_tokens();
    return NextResponse.json({ owner: true, configured, connected: configured && !!tokens });
  } catch (error) {
    console.error('Google status error:', error);
    return NextResponse.json({ error: 'Failed to read Drive status' }, { status: 500 });
  }
}
