'use client';

/**
 * One line on the main page saying whether the Claude API is up, read from
 * status.claude.com through /api/claude-status. Gray means "couldn't tell",
 * never "fine". Styled like SyncStatus so status lines look the same app-wide.
 */

import { useEffect, useRef, useState } from 'react';
import {
  CHECKING,
  STATUS_PAGE_URL,
  UNAVAILABLE,
  parse_claude_status_response,
  type ClaudeStatusView,
} from '@/lib/claude_status';

const DOT: Record<ClaudeStatusView['level'], string> = {
  ok: 'bg-green-500',
  issue: 'bg-red-500',
  unknown: 'bg-gray-500',
};

// Coming back to the tab rechecks, at most once a minute.
const RECHECK_MS = 60_000;

export default function ClaudeStatus() {
  const [status, set_status] = useState<ClaudeStatusView>(CHECKING);
  const last_checked = useRef(0);

  useEffect(() => {
    // Keeps showing the last result while a recheck runs, so the line doesn't flicker.
    const check = () => {
      last_checked.current = Date.now();
      fetch('/api/claude-status')
        .then(r => (r.ok ? r.json() : null))
        .then(parse_claude_status_response)
        .catch(() => UNAVAILABLE)
        .then(set_status);
    };

    const on_visible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last_checked.current > RECHECK_MS) check();
    };

    check();
    document.addEventListener('visibilitychange', on_visible);
    return () => document.removeEventListener('visibilitychange', on_visible);
  }, []);

  return (
    <a
      href={STATUS_PAGE_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Open status.claude.com"
      className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-cyan-400 transition-colors whitespace-nowrap"
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${DOT[status.level]}`} aria-hidden="true" />
      <span role="status">{status.label}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}
