/**
 * On This Day - Main Page
 * Find Substack posts from any date across all years
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import JSZip from 'jszip';
import Papa from 'papaparse';
import NavTabs from '@/components/nav_tabs';
import { extract_story_title } from '@/lib/story_markup';
import { copy_to_clipboard } from '@/lib/clipboard';

interface Post {
  post_id: string;
  title: string;
  subtitle: string | null;
  post_date: string;
  year: number;
  years_ago: number;
  blurb: string | null;
  url: string;
}

interface PostsResponse {
  date: { month: number; day: number; display: string };
  posts: Post[];
  archive: string | null;
  total_posts: number;
  error?: string;
}

interface GenerateResponse {
  success: boolean;
  story: string;
  blurb: string;
  story_id?: string;
  posts_used: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  error?: string;
}

interface SavedStory {
  id: string;
  created_at: string;
  title: string;
  blurb: string | null;
  edited_at: string | null;
}

/**
 * Escape text for the clipboard HTML, which is also rendered into the on-page
 * preview via dangerouslySetInnerHTML. Post titles, blurbs, and the model's
 * intro and heading all pass through here.
 */
const escape_html = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default function OnThisDay() {
  const { data: session } = useSession();
  const date_input_ref = useRef<HTMLInputElement>(null);
  const [date, set_date] = useState<{ month: number; day: number; display: string } | null>(null);
  const [posts, set_posts] = useState<Post[]>([]);
  const [archive, set_archive] = useState<string | null>(null);
  const [total_posts, set_total_posts] = useState(0);
  const [loading, set_loading] = useState(true);
  const [copy_status, set_copy_status] = useState('');
  const [intro_loading, set_intro_loading] = useState(false);
  const [upload_status, set_upload_status] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [uploading, set_uploading] = useState(false);
  const [full_reimport, set_full_reimport] = useState(false);

  // Story generation state
  const [has_api_key, set_has_api_key] = useState(false);
  const [generating, set_generating] = useState(false);
  const [generated_story, set_generated_story] = useState<string | null>(null);
  const [story_id, set_story_id] = useState<string | null>(null);
  const [existing_story, set_existing_story] = useState<SavedStory | null>(null);
  const [generate_error, set_generate_error] = useState<string | null>(null);
  const [token_usage, set_token_usage] = useState<{ input: number; output: number; cached: number } | null>(null);


  // Fetch error state (for /api/posts failures)
  const [fetch_error, set_fetch_error] = useState<string | null>(null);

  // RSS sync state
  const [sync_status, set_sync_status] = useState<string | null>(null);

  // Copy preview (rendered HTML shown in place of post cards)
  const [copy_preview, set_copy_preview] = useState<string | null>(null);

  const fetch_posts = useCallback(async (month?: number, day?: number) => {
    set_loading(true);
    set_fetch_error(null);
    set_generated_story(null);
    set_story_id(null);
    set_existing_story(null);
    set_generate_error(null);
    set_token_usage(null);
    set_copy_preview(null);
    try {
      const params = month && day ? `?date=${month}-${day}` : '';
      const res = await fetch(`/api/posts${params}`);
      if (!res.ok) {
        throw new Error(`Server error (${res.status})`);
      }
      const data: PostsResponse = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      set_date(data.date);
      set_posts(data.posts);
      set_archive(data.archive);
      set_total_posts(data.total_posts);

      // Check for existing story for this date
      if (month && day) {
        const date_key = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const story_res = await fetch(`/api/story?date=${date_key}`);
        const story_data = await story_res.json();
        if (story_data.story) {
          set_existing_story({
            id: story_data.story.id,
            created_at: story_data.story.created_at,
            title: story_data.story.title,
            blurb: story_data.story.blurb || null,
            edited_at: story_data.story.edited_at || null
          });
        }
      }
    } catch (error) {
      console.error('Error fetching posts:', error);
      set_fetch_error(
        error instanceof Error ? error.message : 'Could not load posts. Check your connection and try again.'
      );
    }
    set_loading(false);
  }, []);

  // Set page title and check if API key is configured
  useEffect(() => {
    document.title = '8i11 | On This Day';
    fetch('/api/config')
      .then(res => res.json())
      .then(data => set_has_api_key(data.has_api_key))
      .catch(() => set_has_api_key(false));

    // Background RSS sync — only for GitHub OAuth admin users
    const user_id = (session?.user as { id?: string } | undefined)?.id;
    const is_github_user = session && user_id && user_id !== 'guest';
    if (is_github_user) {
      set_sync_status('Checking for new posts...');
      fetch('/api/sync')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            set_sync_status(data.message);
            // Clear status after 3 seconds
            setTimeout(() => set_sync_status(null), 3000);
            // If new posts were added, refresh the current view
            if (data.added > 0) {
              const now = new Date();
              fetch_posts(now.getMonth() + 1, now.getDate());
            }
          } else {
            set_sync_status(null);
          }
        })
        .catch(() => set_sync_status(null));
    }
  }, [fetch_posts, session]);

  useEffect(() => {
    // Always use client's local date to avoid server timezone issues
    const now = new Date();
    fetch_posts(now.getMonth() + 1, now.getDate());
  }, [fetch_posts]);

  const handle_date_change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value) {
      const [, month, day] = value.split('-').map(Number);
      fetch_posts(month, day);
    }
  };

  const go_to_relative_day = (offset: number) => {
    const d = offset === 0 || !date
      ? new Date()
      : new Date(new Date().getFullYear(), date.month - 1, date.day);
    if (offset !== 0) {
      d.setDate(d.getDate() + offset);
    }
    // Optimistic title update
    const month_names = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    set_date({
      month: d.getMonth() + 1,
      day: d.getDate(),
      display: `${month_names[d.getMonth()]} ${d.getDate()}`
    });
    fetch_posts(d.getMonth() + 1, d.getDate());
  };

  const handle_title_click = () => {
    try {
      date_input_ref.current?.showPicker();
    } catch {
      date_input_ref.current?.click();
    }
  };

  const is_today = (check_date: { month: number; day: number } | null) => {
    if (!check_date) return false;
    const now = new Date();
    return check_date.month === now.getMonth() + 1 && check_date.day === now.getDate();
  };

  const copy_for_substack = async (version: 'simple' | 'full') => {
    // `date` updates optimistically ahead of fetch_posts, so copying mid-load
    // could describe one day's posts under another day's heading.
    if (!posts.length || !date || loading) return;
    if (version === 'full' && intro_loading) return;

    let intro: string | null = null;
    let heading: string | null = null;
    if (version === 'full') {
      set_intro_loading(true);
      set_copy_status('Generating intro...');
      try {
        const res = await fetch('/api/intro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date_display: date.display,
            posts: posts.map(p => ({ year: p.year, title: p.title, blurb: p.blurb })),
          }),
        });
        const data = await res.json();
        if (!data.success || !data.intro) {
          throw new Error(data.error || 'Intro generation failed');
        }
        intro = data.intro as string;
        heading = (data.heading as string | undefined)?.trim() || null;
      } catch (error) {
        set_intro_loading(false);
        set_copy_status(error instanceof Error ? `Intro failed: ${error.message}` : 'Intro failed');
        setTimeout(() => set_copy_status(''), 4000);
        return;
      }
      set_intro_loading(false);
    }

    // 'simple' makes no model call, so it has no generated heading to use.
    const resolved_heading = heading || `On This Day: ${date.display}`;

    let html = `<h2>${escape_html(resolved_heading)}</h2>\n`;
    if (intro) {
      html += `<p>${escape_html(intro)}</p>\n`;
    }
    for (const post of posts) {
      if (version === 'simple') {
        html += `<p>${post.year}: <a href="${post.url}">${escape_html(post.title)}</a></p>\n`;
      } else {
        const blurb_part = post.blurb ? ` – ${escape_html(post.blurb)}` : '';
        html += `<p>${post.year}: <a href="${post.url}">${escape_html(post.title)}</a>${blurb_part}</p>\n`;
      }
    }
    const text_lines = posts.map(p => `${p.year}: ${p.title} - ${p.url}`);
    const text = [resolved_heading, '', intro, intro ? '' : null, text_lines.join('\n')]
      .filter(line => line !== null)
      .join('\n');

    const result = await copy_to_clipboard(html, text);
    set_copy_status(result === 'failed' ? 'Copy failed' : result === 'html' ? 'Copied!' : 'Copied as text');
    set_copy_preview(html);
    setTimeout(() => set_copy_status(''), 3000);
  };

  const generate_story = async () => {
    if (!date || posts.length === 0) return;
    if (
      existing_story?.edited_at
      && !window.confirm('This will replace your edited story. Continue?')
    ) {
      return;
    }

    set_generating(true);
    set_generate_error(null);
    set_generated_story(null);
    set_story_id(null);
    set_token_usage(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: date.month, day: date.day })
      });

      const data: GenerateResponse = await res.json();

      if (data.success) {
        set_generated_story(data.story);
        set_story_id(data.story_id || null);
        // Update existing_story to the newly generated one
        if (data.story_id && date) {
          const title = extract_story_title(data.story, date.display);
          set_existing_story({
            id: data.story_id,
            created_at: new Date().toISOString(),
            title,
            blurb: data.blurb || null,
            edited_at: null
          });
        }
        set_token_usage({
          input: data.usage.input_tokens,
          output: data.usage.output_tokens,
          cached: data.usage.cache_read_input_tokens || 0
        });
      } else {
        set_generate_error(data.error || 'Failed to generate story');
      }
    } catch (error) {
      set_generate_error(error instanceof Error ? error.message : 'Failed to generate story');
    }

    set_generating(false);
  };

  const copy_story_card = async () => {
    const active_story_id = story_id || existing_story?.id;
    if (!active_story_id || !existing_story?.blurb) return;

    const base_url = window.location.origin;
    const link = `${base_url}/story/${active_story_id}`;
    const html = `<h2>${escape_html(existing_story.title)}</h2>\n<p>${escape_html(existing_story.blurb)}</p>\n<p>Read more: <a href="${link}">${link}</a></p>`;
    const text = `${existing_story.title}\n\n${existing_story.blurb}\n\nRead more: ${link}`;

    const result = await copy_to_clipboard(html, text);
    set_copy_status(result === 'failed' ? 'Copy failed' : 'Story card copied!');
    setTimeout(() => set_copy_status(''), 3000);
  };

  const handle_upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    set_uploading(true);
    set_upload_status(null);

    try {
      const zip = await JSZip.loadAsync(file);

      const csv_file = zip.file('posts.csv') || zip.file(/posts\.csv$/i)[0];
      if (!csv_file) {
        throw new Error('posts.csv not found in archive');
      }

      const csv_text = await csv_file.async('text');
      const parsed = Papa.parse<Record<string, string>>(csv_text, { header: true });

      if (parsed.errors.length > 0) {
        console.warn('CSV parse warnings:', parsed.errors);
      }

      // Step 1: Initialize (clear if full reimport, otherwise just set archive info)
      set_upload_status({ type: 'success', message: full_reimport ? 'Clearing database...' : 'Preparing incremental import...' });
      const init_res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_type: full_reimport ? 'clear' : 'init',
          filename: file.name
        })
      });

      const init_result = await init_res.json();
      if (!init_result.success) {
        throw new Error(init_result.error || 'Failed to initialize');
      }

      // Step 2: Upload posts in batches
      const posts_batch_size = 500;
      let total_processed = 0;
      let total_new = 0;
      for (let i = 0; i < parsed.data.length; i += posts_batch_size) {
        const batch = parsed.data.slice(i, i + posts_batch_size);
        set_upload_status({
          type: 'success',
          message: `Processing posts... ${Math.min(i + posts_batch_size, parsed.data.length)}/${parsed.data.length}${total_new > 0 ? ` (${total_new} new)` : ''}`
        });

        const posts_res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch_type: 'posts_batch',
            posts: batch
          })
        });

        const posts_result = await posts_res.json();
        if (!posts_result.success) {
          throw new Error(posts_result.error || 'Failed to upload posts');
        }
        total_processed += posts_result.processed || posts_result.count;
        total_new += posts_result.count;
      }

      // Step 3: Extract and upload HTML in batches (only for new posts if incremental)
      const html_entries = zip.file(/posts\/.*\.html$/i);
      const batch_size = 50; // ~50 files per batch to stay under 4.5MB
      let uploaded_html = 0;

      for (let i = 0; i < html_entries.length; i += batch_size) {
        const batch_entries = html_entries.slice(i, i + batch_size);
        const html_batch: Record<string, string> = {};

        for (const entry of batch_entries) {
          const html = await entry.async('text');
          const match = entry.name.match(/posts\/(\d+\.[^/]+)\.html$/i);
          if (match) {
            html_batch[match[1]] = html;
          }
        }

        set_upload_status({
          type: 'success',
          message: `Processing content... ${Math.min(i + batch_size, html_entries.length)}/${html_entries.length}${uploaded_html > 0 ? ` (${uploaded_html} new)` : ''}`
        });

        const html_res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch_type: 'html_batch',
            html_files: html_batch,
            incremental: !full_reimport
          })
        });

        const html_result = await html_res.json();
        if (!html_result.success) {
          throw new Error(html_result.error || 'Failed to upload HTML batch');
        }
        uploaded_html += html_result.updated || Object.keys(html_batch).length;
      }

      const summary = full_reimport
        ? `Loaded ${total_new} posts with ${uploaded_html} content files`
        : `Added ${total_new} new posts (${total_processed - total_new} existing skipped)`;

      set_upload_status({
        type: 'success',
        message: summary
      });

      if (date) {
        fetch_posts(date.month, date.day);
      }
    } catch (error) {
      set_upload_status({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to process archive'
      });
    }

    set_uploading(false);
    e.target.value = '';
  };

  const get_years_text = (years_ago: number) => {
    if (years_ago === 0) return 'this year';
    if (years_ago === 1) return '1 year ago';
    return `${years_ago} years ago`;
  };

  const today = new Date();
  const date_input_value = date
    ? `${today.getFullYear()}-${date.month.toString().padStart(2, '0')}-${date.day.toString().padStart(2, '0')}`
    : '';
  const current_story_id = story_id || existing_story?.id || null;
  const current_story_blurb = existing_story?.blurb || null;
  const is_authenticated = !!session;
  const control_group_class = 'mb-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4';
  const control_label_text_class = 'text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/70';
  const collapsible_summary_class = 'cursor-pointer list-none';
  const collapsible_summary_row_class = 'mb-3 flex items-center justify-between gap-3';
  const collapsible_arrow_class = 'text-sm text-gray-500';
  const action_button_class = 'inline-flex w-full sm:w-auto items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50';
  const secondary_button_class = `${action_button_class} border-cyan-400/30 bg-white/[0.03] text-cyan-200 hover:border-cyan-300 hover:bg-cyan-400/15 hover:text-white`;
  const subtle_button_class = `${action_button_class} border-white/10 bg-transparent text-gray-300 hover:border-cyan-400/30 hover:text-cyan-200`;
  const primary_button_class = `${action_button_class} border-amber-300/50 bg-gradient-to-r from-amber-300 to-orange-300 text-[#16213e] hover:from-amber-200 hover:to-orange-200`;

  // SVG arrow icons
  const left_arrow = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
  const right_arrow = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] to-[#16213e] text-gray-200 p-5">
      <div className="max-w-3xl mx-auto">
        {/* Navigation */}
        <NavTabs />

        {/* Page heading with date navigation */}
        <div className="flex items-center justify-center gap-3 mb-3">
          <button
            onClick={() => go_to_relative_day(-1)}
            aria-label="Previous day"
            className="p-3 text-gray-400 hover:text-cyan-400 transition-colors rounded-lg"
          >
            {left_arrow}
          </button>
          <h1 className="text-center text-2xl sm:text-3xl font-light text-cyan-400">
            On This Day:{' '}
            <div className="relative inline-block">
              <button
                onClick={handle_title_click}
                aria-label={`Select date, currently ${date?.display || 'loading'}`}
                className="underline decoration-dotted underline-offset-4 decoration-cyan-400/40 cursor-pointer hover:text-cyan-300 transition-colors"
              >
                {date?.display || '...'}
              </button>
              <input
                ref={date_input_ref}
                type="date"
                value={date_input_value}
                onChange={handle_date_change}
                className="absolute inset-0 opacity-0 pointer-events-none"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          </h1>
          <button
            onClick={() => go_to_relative_day(1)}
            aria-label="Next day"
            className="p-3 text-gray-400 hover:text-cyan-400 transition-colors rounded-lg"
          >
            {right_arrow}
          </button>
        </div>

        {/* Post count and back to today */}
        <div className="mb-5 text-center text-sm text-gray-400">
          {!loading && !fetch_error && posts.length > 0 && (
            <p>
              {posts.length} post{posts.length !== 1 ? 's' : ''} on this day
            </p>
          )}
          {date && !is_today(date) && (
            <button
              onClick={() => go_to_relative_day(0)}
              className="mt-2 text-xs text-gray-400 hover:text-cyan-400 transition-colors"
            >
              Back to today
            </button>
          )}
        </div>

        {/* RSS sync status */}
        {sync_status && (
          <p className="text-center text-xs text-cyan-400/70 mb-3 animate-pulse">
            {sync_status}
          </p>
        )}

        {/* Loading state */}
        {loading && (
          <div className="text-center py-16 text-gray-400">
            <p>Loading...</p>
          </div>
        )}

        {/* Fetch error state */}
        {!loading && fetch_error && (
          <div className="py-10 text-center">
            <div className="inline-block bg-red-900/40 border border-red-500/50 rounded-xl px-6 py-5 max-w-sm">
              <p className="text-red-300 mb-4">{fetch_error}</p>
              <button
                onClick={() => {
                  if (date) {
                    fetch_posts(date.month, date.day);
                  } else {
                    const now = new Date();
                    fetch_posts(now.getMonth() + 1, now.getDate());
                  }
                }}
                className="px-5 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm hover:bg-red-500/40 hover:text-white transition-all"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* No posts state */}
        {!loading && !fetch_error && total_posts === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-5xl mb-5">📦</p>
            <p className="mb-2">No archive loaded</p>
            <p className="text-sm">Upload your Substack export below to get started</p>
          </div>
        )}

        {/* Empty date state */}
        {!loading && !fetch_error && total_posts > 0 && posts.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-5xl mb-5">📭</p>
            <p>No posts found for {date?.display}</p>
          </div>
        )}

        {/* Posts */}
        {!loading && !fetch_error && posts.length > 0 && (
          <>
            <details open className={control_group_class}>
              <summary className={collapsible_summary_class}>
                <div className={collapsible_summary_row_class}>
                  <span className={control_label_text_class}>Tools</span>
                  <span aria-hidden="true" className={collapsible_arrow_class}>{'>'}</span>
                </div>
              </summary>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {has_api_key && (
                  <button
                    onClick={generate_story}
                    disabled={generating}
                    className={primary_button_class}
                  >
                    {generating ? 'Writing...' : existing_story ? 'Regenerate Story' : 'Generate Story'}
                  </button>
                )}
                {current_story_id && (
                  <a
                    href={`/story/${current_story_id}`}
                    className={secondary_button_class}
                  >
                    View Saved Story
                  </a>
                )}
                {is_authenticated && current_story_id && (
                  <a
                    href={`/creative/edit/${current_story_id}`}
                    className={secondary_button_class}
                  >
                    Edit Story
                  </a>
                )}
                <button
                  onClick={() => copy_for_substack('simple')}
                  className={secondary_button_class}
                >
                  Posts
                </button>
                <button
                  onClick={() => copy_for_substack('full')}
                  disabled={intro_loading}
                  className={secondary_button_class}
                >
                  {intro_loading ? 'Generating intro...' : 'Posts + Intro'}
                </button>
                {current_story_id && current_story_blurb && (
                  <button
                    onClick={copy_story_card}
                    className={secondary_button_class}
                  >
                    Copy Story Card
                  </button>
                )}
                <a
                  href="/creative/archive"
                  className={subtle_button_class}
                >
                  Archive
                </a>
              </div>

              {/* Story metadata */}
              {existing_story && (
                <p className="mt-3 text-xs text-gray-400">
                  Saved {new Date(existing_story.created_at).toLocaleDateString()}
                  {existing_story.edited_at && `, edited ${new Date(existing_story.edited_at).toLocaleDateString()}`}
                </p>
              )}

              {/* Copy status */}
              {copy_status && (
                <p className="mt-3 text-sm text-green-400">{copy_status}</p>
              )}
            </details>

            {/* Generate error */}
            {generate_error && (
              <div className="mb-6 p-4 bg-red-400/10 border border-red-400/30 rounded-lg text-red-400 text-center">
                {generate_error}
              </div>
            )}

            {/* Generated story */}
            {generated_story && (
              <div className="mb-8 p-6 bg-white/5 border border-purple-400/30 rounded-xl">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-purple-400 font-medium">Story Preview</h3>
                  {token_usage && (
                    <span className="text-xs text-gray-400">
                      {token_usage.input + token_usage.output} tokens
                      {token_usage.cached > 0 && ` (${token_usage.cached} cached)`}
                    </span>
                  )}
                </div>
                <div
                  className="prose prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: generated_story }}
                />
              </div>
            )}

            {current_story_blurb && (
              <div className="mb-6 rounded-2xl border border-amber-300/35 bg-gradient-to-r from-amber-300/25 to-orange-300/20 p-5">
                <p className="text-sm leading-relaxed text-amber-50">
                  {current_story_blurb}
                </p>
              </div>
            )}

            {/* Copy preview or Post cards */}
            {copy_preview ? (
              <div className="mb-4">
                <div className="flex justify-end mb-2">
                  <button
                    onClick={() => set_copy_preview(null)}
                    className="text-gray-400 hover:text-cyan-400 text-sm"
                  >
                    ← Show posts
                  </button>
                </div>
                <div
                  className="bg-white/5 rounded-xl p-6 border border-cyan-400/30 prose prose-invert prose-sm max-w-none [&_a]:text-cyan-400 [&_a]:no-underline [&_a:hover]:underline"
                  dangerouslySetInnerHTML={{ __html: copy_preview }}
                />
              </div>
            ) : posts.map((post) => (
              <div
                key={post.post_id}
                className="bg-white/5 rounded-xl p-5 mb-4 border border-white/10 hover:translate-x-1 hover:border-cyan-400 transition-all"
              >
                <span className="inline-block bg-cyan-400 text-[#1a1a2e] px-3 py-1 rounded-full text-sm font-semibold mb-2">
                  {post.year}
                </span>
                <span className="text-gray-400 text-sm ml-3">
                  {get_years_text(post.years_ago)}
                </span>
                <h2 className="text-xl text-white mb-2">
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-cyan-400"
                  >
                    {post.title}
                  </a>
                </h2>
                {post.blurb && (
                  <p className="text-gray-400 text-sm leading-relaxed">{post.blurb}</p>
                )}
              </div>
            ))}
          </>
        )}

        {/* Upload section */}
        <div className="mt-10 pt-5 border-t border-white/10">
          {archive && (
            <p className="mb-4 text-center text-sm text-gray-400">
              Archive: {archive} ({total_posts.toLocaleString()} posts)
            </p>
          )}
          <details className="text-center">
            <summary className="cursor-pointer text-gray-400 text-sm hover:text-cyan-400">
              Update Archive
            </summary>
            <div className="mt-5 p-5 bg-white/[0.03] rounded-xl">
              {upload_status && (
                <p
                  className={`mb-4 p-3 rounded-lg ${
                    upload_status.type === 'success'
                      ? 'text-green-400 bg-green-400/10'
                      : 'text-red-400 bg-red-400/10'
                  }`}
                >
                  {upload_status.message}
                </p>
              )}
              <p className="text-gray-400 mb-4">Upload a new Substack export (.zip)</p>
              <div className="mb-4">
                <input
                  type="file"
                  accept=".zip"
                  onChange={handle_upload}
                  disabled={uploading}
                  className="text-gray-400 mr-3"
                />
                {uploading && <span className="text-cyan-400">Processing...</span>}
              </div>
              <label className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={full_reimport}
                  onChange={(e) => set_full_reimport(e.target.checked)}
                  disabled={uploading}
                  className="rounded"
                />
                Full reimport (clear existing posts first)
              </label>
              <p className="text-xs text-gray-400 mt-4">
                Get your archive from{' '}
                <a
                  href="https://8i11.substack.com/publish/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline"
                >
                  Substack Settings
                </a>{' '}
                → Export
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
