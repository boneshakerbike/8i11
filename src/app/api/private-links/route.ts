/**
 * GET /api/private-links
 *
 * The private (Tailscale-only) links for the home page's admin block. Admin only,
 * the same check that shows that block, so guests never receive the addresses.
 * Only the list is returned: the links themselves are never checked or fetched
 * from here (Vercel cannot reach them).
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { auth_options } from '@/lib/auth';
import { PRIVATE_LINKS } from '@/lib/private_links';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(auth_options);
  const is_admin = !!session?.user && (session.user as { id?: string }).id !== 'guest';
  if (!is_admin) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  return NextResponse.json(
    { links: PRIVATE_LINKS },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
