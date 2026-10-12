/**
 * API route: GET /api/coros/data?days=14
 * COROS data synced through MCP: daily rows and activities, newest first.
 * Any signed-in session can read it, like the Oura page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { get_client } from '@/lib/db'
import { get_coros_activities, get_coros_days } from '@/lib/coros/data'
import { coros_connection_status, coros_origin } from '@/lib/coros/mcp-client'
import { mt_date_str } from '@/lib/coaching/day'
import { shift_date } from '@/lib/coaching/day'

export async function GET(request: NextRequest) {
  if (!(await getToken({ req: request }))) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days')) || 14, 1), 90)
  const end = mt_date_str()
  const start = shift_date(end, days - 1)
  const db = get_client()
  const [rows, activities, status] = await Promise.all([
    get_coros_days(db, start, end),
    get_coros_activities(db, start, end),
    coros_connection_status(coros_origin(request.nextUrl.origin)),
  ])
  return NextResponse.json({ start, end, connected: status.connected, days: rows, activities })
}
