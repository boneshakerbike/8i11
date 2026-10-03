/**
 * Say What?
 * Paste rough text, get it cleaned up for clarity, edit, then copy
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import NavTabs from '@/components/nav_tabs';
import { build_issue_url } from '@/lib/github_issue';
import { knowledge_filename } from '@/lib/knowledge_doc';

interface TextNote {
  id: string;
  content: string;
  created_at: string;
}

interface DriveStatus {
  owner: boolean;
  configured?: boolean;
  connected: boolean;
}

interface DrivePreview {
  plan_id: string | null;
  status: 'ready' | 'no_new_info' | 'needs_folder' | 'nothing_valid';
  reasoning: string;
  edits: { kind: 'insert' | 'create'; path: string; location: string; text: string; shared: boolean }[];
  rejected: string[];
  suggested_folder: string | null;
}

interface DriveResult {
  path: string;
  view_url?: string;
  result: 'updated' | 'created' | 'skipped';
  reason?: string;
}

// Parse a JSON response; the auth proxy answers some requests with a login
// redirect (HTML), which should read as an error rather than throw.
const read_json = async (res: Response): Promise<Record<string, unknown> | null> => {
  try { return await res.json(); } catch { return null; }
};

export default function TextCleanerPage() {
  const [input, set_input] = useState('');
  const [cleaned, set_cleaned] = useState('');
  const [story, set_story] = useState('');
  const [loading_action, set_loading_action] = useState<'clean' | 'clarify' | 'knowledge' | 'first_person' | 'story' | 'substack' | 'save' | 'delete' | 'drive' | 'drive_apply' | null>(null);
  const [output_mode, set_output_mode] = useState<'clean' | 'clarify' | 'knowledge' | 'first_person' | null>(null);
  const [error, set_error] = useState<string | null>(null);
  const [copy_status, set_copy_status] = useState<string | null>(null);
  const [clean_usage, set_clean_usage] = useState<{ input_tokens: number; output_tokens: number } | null>(null);
  const [story_usage, set_story_usage] = useState<{ input_tokens: number; output_tokens: number } | null>(null);
  const [images, set_images] = useState<File[]>([]);
  const [image_previews, set_image_previews] = useState<string[]>([]);
  const [substack, set_substack] = useState('');
  const [substack_usage, set_substack_usage] = useState<{ input_tokens: number; output_tokens: number } | null>(null);
  const [notes, set_notes] = useState<TextNote[]>([]);
  const [confirm_delete_id, set_confirm_delete_id] = useState<string | null>(null);
  const [confirm_delete_context, set_confirm_delete_context] = useState<'copy' | 'story' | null>(null);
  const [drive_status, set_drive_status] = useState<DriveStatus | null>(null);
  const [drive_preview, set_drive_preview] = useState<DrivePreview | null>(null);
  const [drive_results, set_drive_results] = useState<DriveResult[] | null>(null);
  const hydrated = useRef(false);
  const fetch_notes = useCallback(async () => {
    try {
      const res = await fetch('/api/text-notes');
      if (res.ok) {
        const data = await res.json();
        set_notes(data.notes || []);
      }
    } catch {
      // silently fail — notes list is supplementary
    }
  }, []);

  useEffect(() => {
    fetch_notes();
  }, [fetch_notes]);

  // Drive filing is owner-only; guests get owner:false and never see the button.
  useEffect(() => {
    fetch('/api/google/status')
      .then(read_json)
      .then(data => { if (data && typeof data.owner === 'boolean') set_drive_status(data as unknown as DriveStatus); })
      .catch(() => { /* no Drive button */ });
  }, []);

  // Coming back from Google's consent screen: report the outcome, then tidy the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('drive') === 'connected';
    const drive_error = params.get('drive_error');
    if (!connected && !drive_error) return;
    if (connected) {
      set_copy_status('Google Drive connected');
      setTimeout(() => set_copy_status(null), 3000);
    } else {
      set_error(drive_error === 'scope_not_granted'
        ? 'Drive access wasn\'t granted. Connect again and leave the Drive box ticked.'
        : `Couldn't connect Google Drive (${drive_error}).`);
    }
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Save to localStorage after hydration (hydrated guard prevents overwriting saved data on first render).
  // The raw input is intentionally NOT persisted — recovery only protects the paid/slow output
  // (cleaned/story) so you always land on an empty input box ready to type or paste.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      const has_content = cleaned || story;
      if (has_content) {
        localStorage.setItem('waits_v', '1');
        localStorage.removeItem('waits_input');
        if (cleaned) localStorage.setItem('waits_cleaned', cleaned); else localStorage.removeItem('waits_cleaned');
        if (story) localStorage.setItem('waits_story', story); else localStorage.removeItem('waits_story');
        if (cleaned && output_mode) localStorage.setItem('waits_output_mode', output_mode);
        else localStorage.removeItem('waits_output_mode');
      } else {
        ['waits_v', 'waits_input', 'waits_cleaned', 'waits_story', 'waits_output_mode'].forEach(k => localStorage.removeItem(k));
      }
    } catch {
      // localStorage unavailable (sandboxed iframe, private mode, quota) — persistence is best-effort
    }
  }, [cleaned, story, output_mode]);

  // Restore from localStorage on mount; version key guards against stale schema.
  // waits_output_mode is read additively (no version bump): if missing but cleaned
  // text exists, default to 'clean' so older client drafts survive deploy.
  useEffect(() => {
    try {
      if (localStorage.getItem('waits_v') !== '1') { hydrated.current = true; return; }
      const saved_cleaned     = localStorage.getItem('waits_cleaned');
      const saved_story       = localStorage.getItem('waits_story');
      const saved_output_mode = localStorage.getItem('waits_output_mode');
      if (saved_cleaned) set_cleaned(saved_cleaned);
      if (saved_story)   set_story(saved_story);
      if (saved_cleaned) {
        set_output_mode(
          saved_output_mode === 'clarify' || saved_output_mode === 'knowledge' || saved_output_mode === 'first_person'
            ? saved_output_mode
            : 'clean'
        );
      }
    } catch {
      // localStorage unavailable — skip restore
    } finally {
      hydrated.current = true;
    }
  }, []);

  // POST to /api/clean-text with one retry on transient (network/timeout) failure.
  // Returns { res, data } for any JSON response (ok or not) so callers handle server
  // errors; throws Error('TIMEOUT') for non-JSON bodies (504 gateway pages) and the
  // underlying TypeError for dropped connections. Real server errors are not retried.
  const post_clean_text = async (body: object): Promise<{ res: Response; data: { error?: string; cleaned?: string; story?: string; substack?: string; truncated?: boolean; usage?: { input_tokens: number; output_tokens: number } } }> => {
    let last_err: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch('/api/clean-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        try {
          const data = await res.json();
          return { res, data };
        } catch {
          // Non-JSON body = gateway timeout (504) or proxy error page, not a server response
          throw new Error('TIMEOUT');
        }
      } catch (e) {
        last_err = e;
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
      }
    }
    throw last_err;
  };

  // Map a thrown request error to an actionable, human message.
  const describe_request_error = (e: unknown, action: string): string => {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'UNSUPPORTED_IMAGE') return 'One of your photos couldn\'t be read (HEIC isn\'t supported) — remove it or use a JPEG or PNG.';
    if (msg === 'TIMEOUT') return 'Generation timed out — your work is still here, try again.';
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || e instanceof TypeError) {
      return 'Lost connection — check your signal and try again.';
    }
    return `Couldn't ${action} — try again.`;
  };

  const rewrite_labels: Record<'clean' | 'clarify' | 'knowledge' | 'first_person', string> = {
    clean: 'clean text',
    clarify: 'clarify text',
    knowledge: 'build knowledge doc',
    first_person: 'convert to first person',
  };

  const run_rewrite = async (op: 'clean' | 'clarify' | 'knowledge' | 'first_person') => {
    if (!input.trim()) return;

    set_loading_action(op);
    set_error(null);

    try {
      const { res, data } = await post_clean_text(
        op === 'clean' ? { content: input } : { content: input, mode: op }
      );

      if (!res.ok) {
        set_error(data.error || 'Something went wrong');
        return;
      }

      set_cleaned(data.cleaned ?? '');
      set_clean_usage(data.usage ?? null);
      if (data.truncated) {
        set_error('The document hit the output limit and stops early. Try a shorter source.');
      }
      set_output_mode(op);
      set_story('');
      set_story_usage(null);
      set_substack('');
      set_substack_usage(null);
    } catch (e) {
      set_error(describe_request_error(e, rewrite_labels[op]));
    } finally {
      set_loading_action(null);
    }
  };

  const clean = () => run_rewrite('clean');
  const clarify = () => run_rewrite('clarify');
  const knowledge_doc = () => run_rewrite('knowledge');
  const first_person = () => run_rewrite('first_person');

  // Hand the markdown to the browser as a file. Object URL rather than a data:
  // URL so a long document isn't capped by the URL length limit.
  const download_knowledge = () => {
    if (!cleaned.trim()) return;
    const blob = new Blob([cleaned], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = knowledge_filename(cleaned);
    link.click();
    URL.revokeObjectURL(url);
  };

  const turn_into_story = async (content?: string) => {
    const text = content || cleaned;
    if (!text.trim()) return;

    set_loading_action('story');
    set_error(null);

    try {
      const { res, data } = await post_clean_text({ content: text, mode: 'story' });

      if (!res.ok) {
        set_error(data.error || 'Something went wrong');
        return;
      }

      set_story(data.story ?? '');
      set_story_usage(data.usage ?? null);
      set_substack('');
      set_substack_usage(null);
    } catch (e) {
      set_error(describe_request_error(e, 'build story'));
    } finally {
      set_loading_action(null);
    }
  };

  const copy_output = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      set_copy_status('Copied!');
      setTimeout(() => set_copy_status(null), 2000);
    } catch {
      set_copy_status('Copy failed');
      setTimeout(() => set_copy_status(null), 2000);
    }
  };

  // Open GitHub's own new-issue form with the cleaned text prefilled; the issue is
  // submitted there, so no token or API route is involved.
  const send_to_github = () => {
    if (!cleaned.trim()) return;
    const { url, truncated } = build_issue_url(cleaned);
    if (truncated) {
      // Not awaited: window.open has to run inside the click gesture or popup
      // blockers (mobile Safari especially) swallow it.
      navigator.clipboard?.writeText(cleaned).catch(() => {});
      set_copy_status('Too long for a link, full text copied to clipboard');
      setTimeout(() => set_copy_status(null), 4000);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const connect_drive = () => {
    window.location.href = '/api/google/authorize';
  };

  // Ask the server where this belongs and what's new. Nothing is written yet.
  const plan_drive = async () => {
    if (!cleaned.trim()) return;
    set_loading_action('drive');
    set_error(null);
    set_drive_results(null);
    try {
      const res = await fetch('/api/drive-knowledge/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: cleaned }),
      });
      const data = await read_json(res);
      if (!res.ok || !data) {
        if (data?.not_connected) set_drive_status(s => s ? { ...s, connected: false } : s);
        set_error((data?.error as string) || 'Couldn\'t work out where this goes in Drive — try again.');
        return;
      }
      set_drive_preview(data as unknown as DrivePreview);
    } catch (e) {
      set_error(describe_request_error(e, 'plan the Drive filing'));
    } finally {
      set_loading_action(null);
    }
  };

  // Write the approved plan. Only the plan id is sent; the edits live on the server.
  const apply_drive = async () => {
    if (!drive_preview?.plan_id) return;
    set_loading_action('drive_apply');
    set_error(null);
    try {
      const res = await fetch('/api/drive-knowledge/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: drive_preview.plan_id }),
      });
      const data = await read_json(res);
      if (!res.ok || !data) {
        if (data?.not_connected) set_drive_status(s => s ? { ...s, connected: false } : s);
        set_error((data?.error as string) || 'Couldn\'t write to Drive — try again.');
        set_drive_preview(null);
        return;
      }
      set_drive_preview(null);
      set_drive_results(data.results as DriveResult[]);
    } catch (e) {
      set_error(describe_request_error(e, 'write to Drive'));
    } finally {
      set_loading_action(null);
    }
  };

  const clear_all = () => {
    set_drive_preview(null);
    set_drive_results(null);
    set_input('');
    set_cleaned('');
    set_story('');
    set_error(null);
    set_clean_usage(null);
    set_story_usage(null);
    set_loading_action(null);
    set_images([]);
    set_image_previews([]);
    set_substack('');
    set_substack_usage(null);
    set_output_mode(null);
  };

  const save_note = async () => {
    if (!cleaned.trim()) return;

    set_loading_action('save');
    try {
      const res = await fetch('/api/text-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: cleaned }),
      });

      if (!res.ok) {
        const data = await res.json();
        set_error(data.error || 'Failed to save note');
        return;
      }

      await fetch_notes();
      set_copy_status('Note saved!');
      setTimeout(() => set_copy_status(null), 2000);
    } catch {
      set_error('Couldn\'t save note — try again');
    } finally {
      set_loading_action(null);
    }
  };

  const delete_note = async (id: string) => {
    set_loading_action('delete');
    try {
      const res = await fetch('/api/text-notes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) {
        const data = await res.json();
        set_error(data.error || 'Failed to delete note');
        return;
      }

      await fetch_notes();
    } catch {
      set_error('Couldn\'t delete note — try again');
    } finally {
      set_loading_action(null);
      set_confirm_delete_id(null);
      set_confirm_delete_context(null);
    }
  };

  const handle_note_copy = async (note: TextNote) => {
    await copy_output(note.content);
    set_confirm_delete_id(note.id);
    set_confirm_delete_context('copy');
  };

  const handle_note_story = (note: TextNote) => {
    set_cleaned(note.content);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Use setTimeout so the cleaned state is set before triggering story generation
    setTimeout(() => {
      turn_into_story(note.content);
    }, 100);
    set_confirm_delete_id(note.id);
    set_confirm_delete_context('story');
  };

  const resize_image = (file: File): Promise<{ data: string; media_type: string }> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const max_dim = 1200;
        let { width, height } = img;
        if (width > max_dim || height > max_dim) {
          if (width > height) {
            height = Math.round((height * max_dim) / width);
            width = max_dim;
          } else {
            width = Math.round((width * max_dim) / height);
            height = max_dim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not available')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const data_url = canvas.toDataURL('image/jpeg', 0.7);
        resolve({ data: data_url.split(',')[1], media_type: 'image/jpeg' });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        // Browser can't decode this file (commonly iPhone HEIC); surface a clear message
        reject(new Error('UNSUPPORTED_IMAGE'));
      };
      img.src = url;
    });
  };

  const handle_image_change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
    set_images(files);
    const previews = files.map(f => URL.createObjectURL(f));
    set_image_previews(previews);
  };

  const remove_image = (index: number) => {
    set_images(prev => prev.filter((_, i) => i !== index));
    set_image_previews(prev => prev.filter((_, i) => i !== index));
  };

  const generate_substack = async () => {
    if (!story.trim()) return;

    set_loading_action('substack');
    set_error(null);

    try {
      const resized = await Promise.all(images.map(resize_image));

      const { res, data } = await post_clean_text({
        mode: 'substack',
        story_text: story.trim(),
        images: resized,
      });

      if (!res.ok) { set_error(data.error || 'Something went wrong'); return; }
      set_substack(data.substack ?? '');
      set_substack_usage(data.usage ?? null);
    } catch (e) {
      set_error(describe_request_error(e, 'generate Substack post'));
    } finally {
      set_loading_action(null);
    }
  };

  const format_date = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] to-[#16213e] text-gray-200 p-5">
      <div className="max-w-4xl mx-auto">
        <NavTabs />

        <h1 className="text-center text-3xl font-light text-cyan-400 mb-2">
          Say What?
        </h1>
        <p className="text-center text-gray-400 mb-8">
          Clean up your ramble, then turn it into a story
        </p>

        {/* Copy toast */}
        {copy_status && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50">
            {copy_status}
          </div>
        )}

        {/* Error toast — fixed so it's visible regardless of scroll position */}
        {error && (
          <div role="alert" className="fixed top-4 left-4 right-4 sm:right-auto sm:max-w-sm bg-red-900/90 border border-red-500/50 rounded-lg px-4 py-3 text-red-200 text-sm shadow-xl z-50 flex items-center gap-3">
            <span className="flex-1">{error}</span>
            <button onClick={() => set_error(null)} aria-label="Dismiss error" className="text-red-300/60 hover:text-red-200 transition-colors shrink-0">✕</button>
          </div>
        )}

        {/* Confirm delete modal */}
        {confirm_delete_id && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1e2a3a] border border-white/20 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="text-lg font-medium text-gray-200 mb-2">Delete this note?</h3>
              <p className="text-sm text-gray-400 mb-5">
                {confirm_delete_context === 'copy'
                  ? "You just copied it — want to delete the saved note?"
                  : "It's been loaded for story creation — want to delete the saved note?"}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => delete_note(confirm_delete_id)}
                  disabled={loading_action === 'delete'}
                  className="flex-1 px-4 py-2 bg-red-500/80 hover:bg-red-500 disabled:bg-white/10 text-white rounded-lg text-sm font-medium transition-all"
                >
                  {loading_action === 'delete' ? 'Deleting...' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => { set_confirm_delete_id(null); set_confirm_delete_context(null); }}
                  className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-gray-300 transition-all"
                >
                  Keep it
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Drive preview: exact files and text, written only on approval */}
        {(drive_preview || drive_results) && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1e2a3a] border border-white/20 rounded-xl p-6 max-w-2xl w-full shadow-2xl max-h-[85vh] overflow-y-auto">
              {drive_preview && (
                <>
                  <h3 className="text-lg font-medium text-gray-200 mb-2">
                    {drive_preview.status === 'ready' ? 'Add to Google Drive?'
                      : drive_preview.status === 'no_new_info' ? 'Nothing new to add'
                      : drive_preview.status === 'needs_folder' ? 'No folder fits yet'
                      : 'Nothing could be filed'}
                  </h3>
                  {drive_preview.reasoning && (
                    <p className="text-sm text-gray-400 mb-4">{drive_preview.reasoning}</p>
                  )}
                  {drive_preview.status === 'needs_folder' && drive_preview.suggested_folder && (
                    <p className="text-sm text-gray-300 mb-4">
                      Suggested folder: <span className="font-mono">{drive_preview.suggested_folder}</span>. Create it in Drive yourself, then run Drive again.
                    </p>
                  )}
                  <div className="space-y-4">
                    {drive_preview.edits.map((edit, i) => (
                      <div key={i} className="border border-white/10 rounded-lg overflow-hidden">
                        <div className="bg-white/5 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
                          <span className="font-mono text-cyan-300 break-all">{edit.path}</span>
                          {edit.shared && (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">Shared with others</span>
                          )}
                          <span className="text-xs text-gray-400 w-full">{edit.location}</span>
                        </div>
                        <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap font-mono">{edit.text}</pre>
                      </div>
                    ))}
                  </div>
                  {drive_preview.rejected.length > 0 && (
                    <div className="mt-4 text-xs text-gray-400">
                      <p className="mb-1">Not included:</p>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {drive_preview.rejected.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                  <div className="flex gap-3 mt-5">
                    {drive_preview.status === 'ready' && drive_preview.plan_id && (
                      <button
                        onClick={apply_drive}
                        disabled={!!loading_action}
                        className="flex-1 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-white/10 disabled:text-gray-500 text-black rounded-lg text-sm font-semibold transition-all"
                      >
                        {loading_action === 'drive_apply' ? 'Writing...' : 'Approve and write'}
                      </button>
                    )}
                    <button
                      onClick={() => set_drive_preview(null)}
                      disabled={loading_action === 'drive_apply'}
                      className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-gray-300 transition-all"
                    >
                      {drive_preview.status === 'ready' ? 'Cancel' : 'Close'}
                    </button>
                  </div>
                </>
              )}
              {drive_results && (
                <>
                  <h3 className="text-lg font-medium text-gray-200 mb-4">Drive updated</h3>
                  <ul className="space-y-2 text-sm">
                    {drive_results.map((r, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-2">
                        <span className={r.result === 'skipped' ? 'text-amber-300' : 'text-green-400'}>
                          {r.result === 'updated' ? 'Updated' : r.result === 'created' ? 'Created' : 'Skipped'}
                        </span>
                        <span className="font-mono text-gray-200 break-all">{r.path}</span>
                        {r.reason && <span className="text-gray-400 w-full text-xs">{r.reason}</span>}
                        {r.view_url && (
                          <a href={r.view_url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300">
                            Open in Drive
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-gray-500 mt-4">Drive&apos;s version history has the previous version if you want to roll back.</p>
                  <button
                    onClick={() => set_drive_results(null)}
                    className="w-full mt-5 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-gray-300 transition-all"
                  >
                    Done
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Input */}
          <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
            <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex justify-between items-center">
              <h3 className="font-medium text-gray-300">Your Text</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{input.length.toLocaleString()} chars</span>
              </div>
            </div>
            <textarea
              value={input}
              onChange={e => set_input(e.target.value)}
              placeholder="Paste or type what you're trying to say. Don't worry about grammar, spelling, or structure — just get it down."
              className="w-full p-4 font-mono text-sm resize-none focus:outline-none bg-transparent text-gray-200 placeholder-gray-600"
              style={{ minHeight: '220px' }}
            />
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row sm:justify-center gap-3">
            <div className="flex gap-3 sm:contents">
              <button
                onClick={clean}
                disabled={!!loading_action || !input.trim()}
                className="flex-1 sm:flex-none sm:w-auto px-8 py-[14px] sm:py-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-white/10 disabled:text-gray-500 text-black font-semibold rounded-lg transition-all text-sm"
              >
                {loading_action === 'clean' ? 'Cleaning...' : 'Clean'}
              </button>
              <button
                onClick={clarify}
                disabled={!!loading_action || !input.trim()}
                className="flex-1 sm:flex-none sm:w-auto px-8 py-[14px] sm:py-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-white/10 disabled:text-gray-500 text-black font-semibold rounded-lg transition-all text-sm"
              >
                {loading_action === 'clarify' ? 'Clarifying...' : 'Clarify'}
              </button>
            </div>
            <div className="flex gap-3 sm:contents">
              <button
                onClick={knowledge_doc}
                disabled={!!loading_action || !input.trim()}
                title="Distil this into a knowledge document in Markdown"
                className="flex-1 sm:flex-none sm:w-auto px-8 py-[14px] sm:py-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-white/10 disabled:text-gray-500 text-black font-semibold rounded-lg transition-all text-sm"
              >
                {loading_action === 'knowledge' ? 'Distilling...' : 'Knowledge'}
              </button>
              <button
                onClick={first_person}
                disabled={!!loading_action || !input.trim()}
                title="Rewrite this in the first person (I, me, my)"
                className="flex-1 sm:flex-none sm:w-auto px-8 py-[14px] sm:py-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-white/10 disabled:text-gray-500 text-black font-semibold rounded-lg transition-all text-sm"
              >
                {loading_action === 'first_person' ? 'Converting...' : 'First Person'}
              </button>
            </div>
            <button
              onClick={clear_all}
              className="w-full sm:w-auto px-4 py-2.5 sm:py-3 bg-amber-500/15 hover:bg-amber-500/30 rounded-lg border border-amber-400/70 text-amber-200 text-sm font-medium transition-all"
            >
              Clear
            </button>
          </div>

          {/* Jump to saved notes */}
          {notes.length > 0 && (
            <div className="text-center">
              <button
                onClick={() => document.getElementById('saved-notes')?.scrollIntoView({ behavior: 'smooth' })}
                className="text-xs text-cyan-400/70 hover:text-cyan-400 transition-colors"
              >
                View saved notes ({notes.length})
              </button>
            </div>
          )}

          {/* Output — editable */}
          {cleaned && (
            <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
              <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-medium text-gray-300">
                    {output_mode === 'clarify' ? 'Clarified' : output_mode === 'knowledge' ? 'Knowledge Doc' : output_mode === 'first_person' ? 'First Person' : 'Cleaned'}
                  </h3>
                  {clean_usage && (
                    <span className="text-xs text-gray-400">
                      {clean_usage.input_tokens + clean_usage.output_tokens} tokens
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => turn_into_story()}
                    disabled={!!loading_action}
                    className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-emerald-400/20 disabled:bg-white/10 disabled:text-gray-500 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                  >
                    {loading_action === 'story' ? 'Building...' : 'Story'}
                  </button>
                  <button
                    onClick={save_note}
                    disabled={!!loading_action}
                    className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-amber-400/20 disabled:bg-white/10 disabled:text-gray-500 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                  >
                    {loading_action === 'save' ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={send_to_github}
                    title="Open a prefilled GitHub issue with this text"
                    className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-sky-400/20 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                  >
                    GitHub
                  </button>
                  {output_mode === 'knowledge' && (
                    <button
                      onClick={download_knowledge}
                      title={`Download as ${knowledge_filename(cleaned)}`}
                      className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-violet-400/20 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                    >
                      Download .md
                    </button>
                  )}
                  {output_mode === 'knowledge' && drive_status?.owner && drive_status.configured && (
                    <button
                      onClick={drive_status.connected ? plan_drive : connect_drive}
                      disabled={!!loading_action}
                      title={drive_status.connected
                        ? 'Find where this belongs in Google Drive and preview what would be added'
                        : 'Connect Google Drive to file knowledge docs there'}
                      className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-green-400/20 disabled:bg-white/10 disabled:text-gray-500 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                    >
                      {loading_action === 'drive' ? 'Finding place...' : drive_status.connected ? 'Drive' : 'Connect Drive'}
                    </button>
                  )}
                  <button
                    onClick={() => copy_output(cleaned)}
                    className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-cyan-400/20 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <textarea
                value={cleaned}
                onChange={e => set_cleaned(e.target.value)}
                className="w-full p-4 font-mono text-sm resize-none focus:outline-none bg-transparent text-gray-200"
                style={{ minHeight: '180px' }}
              />
            </div>
          )}

          {/* Story output */}
          {story && (
            <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
              <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-medium text-gray-300">Story Version</h3>
                  {story_usage && (
                    <span className="text-xs text-gray-400">
                      {story_usage.input_tokens + story_usage.output_tokens} tokens
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={generate_substack}
                    disabled={!!loading_action}
                    className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-violet-400/20 disabled:bg-white/10 disabled:text-gray-500 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                  >
                    {loading_action === 'substack' ? 'Generating...' : 'Substack Post'}
                  </button>
                  <button
                    onClick={() => copy_output(story)}
                    className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-emerald-400/20 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <textarea
                value={story}
                onChange={e => set_story(e.target.value)}
                className="w-full p-4 font-mono text-sm resize-none focus:outline-none bg-transparent text-gray-200"
                style={{ minHeight: '220px' }}
              />
              <div className="px-4 py-3 border-t border-white/10">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="cursor-pointer px-3 py-1.5 bg-[#333] sm:bg-white/10 hover:bg-white/20 rounded border border-[#555] sm:border-white/20 text-xs text-gray-300 transition-all">
                    Add Photos ({images.length}/5)
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      className="hidden"
                      onChange={handle_image_change}
                    />
                  </label>
                  {image_previews.map((src, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element -- blob preview URLs can't use next/image */}
                      <img src={src} alt={`Photo ${i + 1}`} className="h-12 w-12 object-cover rounded border border-white/20" />
                      <button
                        onClick={() => remove_image(i)}
                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center leading-none"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {substack && (
            <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
              <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex justify-between items-center">
                <h3 className="font-medium text-gray-300">Substack Post</h3>
                <div className="flex items-center gap-3">
                  {substack_usage && (
                    <span className="text-xs text-gray-400">
                      {substack_usage.input_tokens + substack_usage.output_tokens} tokens
                    </span>
                  )}
                  <button
                    onClick={() => copy_output(substack)}
                    className="px-3 py-2 sm:py-1 bg-[#333] sm:bg-white/10 hover:bg-violet-400/20 rounded border border-[#555] sm:border-white/20 text-sm text-gray-300 transition-all"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <textarea
                value={substack}
                onChange={e => set_substack(e.target.value)}
                className="w-full p-4 font-mono text-sm resize-none focus:outline-none bg-transparent text-gray-200"
                style={{ minHeight: '300px' }}
              />
            </div>
          )}

          {/* Saved Notes */}
          <div id="saved-notes" className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-gray-300">
                Saved Notes {notes.length > 0 && <span className="text-sm text-gray-500">({notes.length})</span>}
              </h2>
            </div>

            {notes.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No saved notes yet</p>
            ) : (
              <div className="space-y-3">
                {notes.map(note => (
                  <div key={note.id} className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                    <div className="p-4">
                      <p className="text-sm text-gray-300 whitespace-pre-wrap line-clamp-4">{note.content}</p>
                    </div>
                    <div className="px-4 py-2 border-t border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <span className="text-xs text-gray-500">{format_date(note.created_at)}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => handle_note_copy(note)}
                          disabled={!!loading_action}
                          className="px-3 py-1 bg-[#333] sm:bg-white/10 hover:bg-cyan-400/20 disabled:bg-white/10 disabled:text-gray-500 rounded border border-[#555] sm:border-white/20 text-xs text-gray-300 transition-all"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => handle_note_story(note)}
                          disabled={!!loading_action}
                          className="px-3 py-1 bg-[#333] sm:bg-white/10 hover:bg-emerald-400/20 disabled:bg-white/10 disabled:text-gray-500 rounded border border-[#555] sm:border-white/20 text-xs text-gray-300 transition-all"
                        >
                          Story
                        </button>
                        <button
                          onClick={() => delete_note(note.id)}
                          disabled={!!loading_action}
                          className="px-3 py-1 bg-[#333] sm:bg-white/10 hover:bg-red-400/20 disabled:bg-white/10 disabled:text-gray-500 rounded border border-[#555] sm:border-white/20 text-xs text-gray-300 transition-all"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
