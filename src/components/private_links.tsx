/**
 * Private (Tailscale-only) links for the home page's admin block.
 *
 * The list comes from /api/private-links (admin only) so the addresses are not in
 * the page's JavaScript. Each link opens in a new tab and nothing else: the targets
 * are plain http on the tailnet, so no status check, fetch or embed is possible
 * from this https page.
 */

'use client';

import { useEffect, useState } from 'react';
import type { PrivateLink } from '@/lib/private_links';

export default function PrivateLinks() {
  const [links, set_links] = useState<PrivateLink[] | null>(null);
  const [open_help, set_open_help] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/private-links')
      .then(r => (r.ok ? r.json() : null))
      .then(d => set_links(d?.links ?? []))
      .catch(() => set_links([]));
  }, []);

  if (!links || links.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="text-xs text-gray-400 mb-2">Private (Tailscale only, from my devices)</p>
      <div className="space-y-2">
        {links.map((link) => (
          <div key={link.label} className="p-3 rounded-lg border border-cyan-400/20 bg-white/5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-1 text-xs rounded bg-cyan-400/10 border border-cyan-400/20 text-cyan-400 hover:bg-cyan-400/20 transition-colors"
              >
                {link.label} ↗
              </a>
              {link.backup_href && (
                <a
                  href={link.backup_href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-400 hover:text-cyan-400 transition-colors"
                >
                  Backup link ↗
                </a>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-2">{link.description}</p>
            {link.help && link.help.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={() => set_open_help(open_help === link.label ? null : link.label)}
                  aria-expanded={open_help === link.label}
                  className="text-xs text-gray-400 hover:text-cyan-400 transition-colors"
                >
                  If it doesn&apos;t open {open_help === link.label ? '▲' : '▼'}
                </button>
                {open_help === link.label && (
                  <ol className="list-decimal list-inside space-y-1 text-xs text-gray-300 mt-1">
                    {link.help.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
