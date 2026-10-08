/**
 * API route: GET /api/sync
 * Fetches RSS feed from Substack and adds any missing posts to the database
 */

import { NextResponse } from 'next/server';
import { sync_rss_posts } from '@/lib/rss_sync';

export async function GET() {
  try {
    const { added, checked } = await sync_rss_posts();

    if (checked === 0) {
      return NextResponse.json({
        success: true,
        message: 'No posts found in RSS feed',
        added: 0,
        checked: 0
      });
    }

    return NextResponse.json({
      success: true,
      message: added > 0 ? `Added ${added} new post${added > 1 ? 's' : ''}` : 'Up to date',
      added,
      checked
    });

  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
