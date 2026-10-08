/**
 * API route: GET /api/health
 * Returns database health stats including duplicate check
 *
 * POST /api/health?action=cleanup_stories
 * Removes duplicate stories, keeping only the most recent per date
 */

import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@libsql/client';
import { getToken } from 'next-auth/jwt';
import { cleanup_duplicate_stories, cleanup_duplicate_posts } from '@/lib/db';

const is_turso = !!process.env.TURSO_DATABASE_URL;

function get_client() {
  if (is_turso) {
    return createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  } else {
    return createClient({
      url: `file:${path.join(process.cwd(), 'data', 'posts.db')}`,
    });
  }
}

export async function GET() {
  try {
    const db = get_client();

    // Posts stats
    const total = await db.execute('SELECT COUNT(*) as count FROM posts');
    const unique = await db.execute('SELECT COUNT(DISTINCT post_id) as count FROM posts');
    const post_duplicates = await db.execute(
      'SELECT post_id, COUNT(*) as count FROM posts GROUP BY post_id HAVING COUNT(*) > 1'
    );

    // Stories stats
    let stories_total = 0;
    let stories_duplicate_dates = 0;
    try {
      const stories = await db.execute('SELECT COUNT(*) as count FROM stories');
      stories_total = Number(stories.rows[0].count);

      const story_dups = await db.execute(
        'SELECT date_key, COUNT(*) as count FROM stories GROUP BY date_key HAVING COUNT(*) > 1'
      );
      stories_duplicate_dates = story_dups.rows.length;
    } catch {
      // Stories table might not exist yet
    }

    // Coverage of the two columns the title generators mine. Both have real
    // import gaps: the archive upload patches content_html in a second pass,
    // and RSS inserts subtitle as NULL without ever backfilling it.
    const missing_content = await db.execute(
      "SELECT COUNT(*) as count FROM posts WHERE content_html IS NULL OR trim(content_html) = ''"
    );
    const missing_subtitle = await db.execute(
      "SELECT COUNT(*) as count FROM posts WHERE subtitle IS NULL OR trim(subtitle) = ''"
    );

    const total_count = Number(total.rows[0].count);
    const unique_count = Number(unique.rows[0].count);

    return NextResponse.json({
      status: 'ok',
      database: is_turso ? 'turso' : 'sqlite',
      posts: {
        total: total_count,
        unique: unique_count,
        duplicates: post_duplicates.rows.length,
        missing_content_html: Number(missing_content.rows[0].count),
        missing_subtitle: Number(missing_subtitle.rows[0].count),
      },
      stories: {
        total: stories_total,
        duplicate_dates: stories_duplicate_dates,
      }
    });

  } catch (error) {
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Health check failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Require auth for destructive operations (GET stays public for health checks)
  const token = await getToken({ req: request });
  const pin_header = request.headers.get('X-Guest-Pin');
  const valid_pins = (process.env.GUEST_PINS || process.env.GUEST_PIN || '')
    .split(',').map(p => p.trim()).filter(Boolean);

  if (!token && (!pin_header || !valid_pins.includes(pin_header))) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const action = request.nextUrl.searchParams.get('action');

  if (action === 'cleanup_stories') {
    try {
      const removed = await cleanup_duplicate_stories();
      return NextResponse.json({
        success: true,
        message: `Removed ${removed} duplicate stories`,
        removed
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Cleanup failed' },
        { status: 500 }
      );
    }
  }

  if (action === 'cleanup_posts') {
    try {
      const removed = await cleanup_duplicate_posts();
      return NextResponse.json({
        success: true,
        message: `Removed ${removed} duplicate posts`,
        removed
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Cleanup failed' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { error: 'Unknown action. Use ?action=cleanup_stories' },
    { status: 400 }
  );
}
