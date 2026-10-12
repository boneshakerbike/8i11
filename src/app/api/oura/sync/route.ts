/**
 * API route: POST /api/oura/sync
 * Backfills wellness cache for recent days
 * Body: { days: 7 } (default 7, max 30)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { sync_oura } from '@/lib/health/oura-sync';

async function require_auth(request: NextRequest): Promise<NextResponse | null> {
  const token = await getToken({ req: request });
  if (token) return null;

  const pin_header = request.headers.get('X-Guest-Pin');
  if (pin_header) {
    const valid_pins = (process.env.GUEST_PINS || process.env.GUEST_PIN || '')
      .split(',').map(p => p.trim()).filter(Boolean);
    if (valid_pins.includes(pin_header)) return null;
  }

  return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const auth_error = await require_auth(request);
  if (auth_error) return auth_error;

  try {
    const body = await request.json().catch(() => ({}));
    const result = await sync_oura({ days: body.days, force: body.force === true });
    if (!result.connected) {
      return NextResponse.json({ error: 'Oura not connected', connected: false }, { status: 404 });
    }
    if (result.synced === 0 && result.errors.length === 0 && result.skipped > 0) {
      return NextResponse.json({ success: true, synced: 0, skipped: result.skipped, message: 'All dates already cached' });
    }
    return NextResponse.json({
      success: true,
      synced: result.synced,
      skipped: result.skipped,
      errors: result.errors.length > 0 ? result.errors : undefined,
      range: result.range,
    });
  } catch (error) {
    console.error('Oura sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
