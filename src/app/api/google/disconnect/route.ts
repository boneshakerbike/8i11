/**
 * API route: DELETE /api/google/disconnect
 * Revokes the Drive grant at Google and forgets the stored tokens
 */

import { NextRequest, NextResponse } from 'next/server';
import { disconnect_google, require_owner } from '@/lib/google_auth';

export async function DELETE(request: NextRequest) {
  const auth_error = await require_owner(request);
  if (auth_error) return auth_error;

  try {
    await disconnect_google();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Google disconnect error:', error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
