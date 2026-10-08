/**
 * Substack RSS sync, extracted from /api/sync so other routes can refresh the
 * post archive before reading it.
 */

import { get_all_post_ids, add_post_from_rss } from '@/lib/db';

export interface RssPost {
  post_id: string;
  title: string;
  url: string;
  post_date: string;
  content_html: string;
}

const RSS_URL = 'https://8i11.substack.com/feed';

/** Parse RSS XML and extract posts. */
export function parse_rss(xml: string): RssPost[] {
  const posts: RssPost[] = [];
  const item_regex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = item_regex.exec(xml)) !== null) {
    const item = match[1];

    const title_match = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                        item.match(/<title>(.*?)<\/title>/);
    const link_match = item.match(/<link>(.*?)<\/link>/);
    const pub_date_match = item.match(/<pubDate>(.*?)<\/pubDate>/);
    const content_match = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/);

    if (title_match && link_match && pub_date_match) {
      const url = link_match[1].trim();
      const url_match = url.match(/\/p\/([^/?]+)/);
      const post_id = url_match ? url_match[1] : null;

      if (post_id) {
        posts.push({
          post_id,
          title: title_match[1].trim(),
          url,
          post_date: pub_date_match[1].trim(),
          content_html: content_match ? content_match[1] : ''
        });
      }
    }
  }

  return posts;
}

export interface SyncResult {
  added: number;
  checked: number;
}

/** Fetch the feed and insert any posts the database is missing. */
export async function sync_rss_posts(signal?: AbortSignal): Promise<SyncResult> {
  const response = await fetch(RSS_URL, {
    headers: { 'User-Agent': 'OnThisDay/1.0 (RSS Sync)' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch RSS: ${response.status}`);
  }

  const rss_posts = parse_rss(await response.text());
  if (rss_posts.length === 0) return { added: 0, checked: 0 };

  const existing_ids = await get_all_post_ids();
  // Compare by slug — the archive import uses "12345.slug", RSS uses "slug".
  const existing_slugs = new Set(
    existing_ids.map(id => {
      const parts = id.split('.', 2);
      return parts[1] || parts[0];
    })
  );

  const missing_posts = rss_posts.filter(p => !existing_slugs.has(p.post_id));

  let added = 0;
  for (const post of missing_posts) {
    try {
      await add_post_from_rss(post);
      added++;
    } catch (err) {
      console.error(`Failed to add post ${post.post_id}:`, err);
    }
  }

  return { added, checked: rss_posts.length };
}

/**
 * Best-effort refresh with a hard time limit, for routes that want fresh
 * published titles but must never hang on a slow feed. Failures are logged and
 * swallowed: stale history is a far better outcome than a failed generation.
 */
export async function sync_rss_bounded(timeout_ms: number = 4000): Promise<SyncResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    return await sync_rss_posts(controller.signal);
  } catch (e) {
    console.error('Bounded RSS sync skipped:', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
