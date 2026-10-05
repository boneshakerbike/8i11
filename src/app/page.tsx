/**
 * Landing page - Dashboard with category cards and mini links
 * Route: /
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import NavTabs from '@/components/nav_tabs';
import { TOOLS } from '@/lib/tools';
import { SECTION_ACCENTS } from '@/lib/sections';

interface HealthData {
  posts: { total: number };
  stories: { total: number };
}

interface MiniLink {
  label: string;
  href: string;
  external?: boolean;
}

interface Category {
  title: string;
  description: string;
  color: string;
  links: MiniLink[];
}

const ADMIN_QUICK_LINKS = [
  { label: 'Repo',      href: 'https://github.com/boneshakerbike/8i11' },
  { label: 'Issues',    href: 'https://github.com/boneshakerbike/8i11/issues' },
  { label: 'Deploys',   href: 'https://vercel.com/boneshakerbikes-projects/~/deployments' },
  { label: 'Env Vars',  href: 'https://vercel.com/boneshakerbikes-projects/8i11/settings/environment-variables' },
  { label: 'Console',   href: 'https://console.anthropic.com' },
  { label: 'Usage',     href: 'https://claude.ai/settings/usage' },
  { label: 'Scheduled', href: 'https://8i11.substack.com/publish/posts/scheduled' },
  { label: 'Turso',     href: 'https://app.turso.tech' },
  { label: 'Oura Dev',  href: 'https://developer.ouraring.com/applications' },
];

function AdminSection({
  title,
  children,
  is_open,
  on_toggle,
}: {
  title: string;
  children: React.ReactNode;
  is_open: boolean;
  on_toggle: () => void;
}) {
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={on_toggle}
        className="w-full flex justify-between items-center px-3 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors text-left"
      >
        <span>{title}</span>
        <span className="text-gray-400">{is_open ? '▲' : '▼'}</span>
      </button>
      {is_open && (
        <div className="px-3 py-3 text-sm text-gray-400 border-t border-white/10">
          {children}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const { data: session } = useSession();
  const is_admin = !!(session?.user && (session.user as { id?: string }).id !== 'guest');
  const [health, set_health] = useState<HealthData | null>(null);
  const [open_doc, set_open_doc] = useState<string | null>(null);

  useEffect(() => { document.title = '8i11 | Home'; }, []);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => { if (d.status === 'ok') set_health(d); })
      .catch(() => {});
  }, []);

  const categories: Category[] = [
    {
      title: 'Creative',
      description: 'Browse Substack posts by date, generate reflective stories',
      color: 'cyan',
      links: [
        { label: 'On This Day', href: '/creative' },
        { label: 'Archive', href: '/creative/archive' },
        { label: 'Say What?', href: '/creative/text-cleaner' },
      ],
    },
    {
      title: 'Tools',
      description: 'Utilities for writing, thinking, and building',
      color: 'purple',
      // Links sourced from src/lib/tools.ts — single source of truth
      links: TOOLS.map((t) => ({ label: t.label, href: t.path })),
    },
    {
      title: 'Health',
      description: 'Oura Ring, Ride with GPS, and COROS training data',
      color: 'green',
      links: [
        ...(is_admin ? [{ label: 'Coach', href: '/coach' }] : []),
        { label: 'Oura', href: '/health/oura' },
        { label: 'Ride with GPS', href: '/health/ridewithgps' },
        { label: 'COROS', href: '/health/coros' },
      ],
    },
    {
      title: 'Games',
      description: 'Pixel art classics, brick breakers, and F1 predictions',
      color: 'pink',
      links: [
        { label: 'Frogger', href: '/games/frogger' },
        { label: 'Breakout', href: '/games/breakout' },
        { label: 'F1 Predictions', href: '/games/f1' },
      ],
    },
    {
      title: 'Weather',
      description: 'TV-optimized weather display for Missoula, MT',
      color: 'amber',
      links: [
        { label: 'Weather Display', href: '/weather' },
      ],
    },
  ];

  const color_map: Record<string, { border: string; hover_bg: string; text: string; link: string }> = {
    cyan:   { border: 'border-cyan-400/20',   hover_bg: 'hover:bg-cyan-400/5',   text: 'text-cyan-400',   link: 'text-cyan-400/60 hover:text-cyan-400' },
    purple: { border: 'border-purple-400/20', hover_bg: 'hover:bg-purple-400/5', text: 'text-purple-400', link: 'text-purple-400/60 hover:text-purple-400' },
    green:  { border: 'border-green-400/20',  hover_bg: 'hover:bg-green-400/5',  text: 'text-green-400',  link: 'text-green-400/60 hover:text-green-400' },
    pink:   { border: 'border-pink-400/20',   hover_bg: 'hover:bg-pink-400/5',   text: 'text-pink-400',   link: 'text-pink-400/60 hover:text-pink-400' },
    amber:  { border: 'border-amber-400/20',  hover_bg: 'hover:bg-amber-400/5',  text: 'text-amber-400',  link: 'text-amber-400/60 hover:text-amber-400' },
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] to-[#16213e] text-gray-200 p-5">
      <div className="max-w-3xl mx-auto">
        <NavTabs />

        <div className="text-center mb-6 mt-2 sm:mb-12 sm:mt-4">
          <p className="text-gray-400 text-sm">Creative tools and games by William Martin</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-16">
          {categories.map((cat) => {
            const colors = color_map[cat.color];
            return (
              <div
                key={cat.title}
                className={`p-6 rounded-xl border ${colors.border} bg-white/5`}
              >
                <h2 className="text-lg font-medium mb-1" style={{ color: SECTION_ACCENTS[cat.title] }}>{cat.title}</h2>
                <p className="hidden sm:block text-gray-400 text-sm leading-relaxed mb-3">{cat.description}</p>

                {/* Action links */}
                <div className="grid grid-cols-2 gap-2 mb-1 sm:grid-cols-none sm:flex sm:flex-wrap">
                  {cat.links.map((link) => (
                    <Link
                      key={link.label}
                      href={link.href}
                      className="max-sm:last:odd:col-span-2 flex-1 basis-[140px] min-w-[130px] px-3 py-3 rounded-lg text-sm text-left text-[#bca6f7] bg-[rgba(167,139,250,0.06)] border border-[rgba(167,139,250,0.26)] hover:bg-[rgba(167,139,250,0.16)] hover:border-[rgba(167,139,250,0.5)] transition-colors"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Admin & Resources */}
        {is_admin && (
          <div className="mb-10">
            <p className="text-xs uppercase tracking-widest text-gray-400 mb-4">Admin &amp; Resources</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {ADMIN_QUICK_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 text-xs rounded bg-cyan-400/10 border border-cyan-400/20 text-cyan-400 hover:bg-cyan-400/20 transition-colors"
                >
                  {link.label} ↗
                </a>
              ))}
            </div>
            <div className="space-y-1.5">
              <AdminSection
                title="Permissions &amp; Access Control"
                is_open={open_doc === 'Permissions & Access Control'}
                on_toggle={() => set_open_doc(open_doc === 'Permissions & Access Control' ? null : 'Permissions & Access Control')}
              >
                <p className="mb-3">Two-tier model: <strong className="text-white">admin</strong> (GitHub login) and <strong className="text-white">guest</strong> (PIN login). Every GitHub user on the allowlist gets full admin access.</p>
                <h4 className="font-medium text-cyan-400 mt-3 mb-2">Identity</h4>
                <p className="text-gray-300 mb-2">Session carries <code className="bg-white/10 px-1 rounded">user.id</code>. GitHub users get their numeric ID; guest PIN users get the string <code className="bg-white/10 px-1 rounded">guest</code>. Every check is: <em>is this user &quot;guest&quot; or not?</em></p>
                <h4 className="font-medium text-cyan-400 mt-3 mb-2">What each tier can do</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left border-b border-white/10"><th className="py-2 pr-4 text-gray-400">Action</th><th className="py-2 pr-4 text-gray-400">Admin</th><th className="py-2 text-gray-400">Guest</th></tr></thead>
                    <tbody className="text-gray-300">
                      {[['Use all tools & pages','✓','✓'],['F1: make predictions','✓','✓'],['Generate AI stories','✓','✓'],['F1: manage roster & reset','✓','✗']].map(([action, adm, gst]) => (
                        <tr key={action} className="border-b border-white/5">
                          <td className="py-1.5 pr-4">{action}</td>
                          <td className={`py-1.5 pr-4 ${adm === '✓' ? 'text-green-400' : 'text-red-400'}`}>{adm}</td>
                          <td className={`py-1.5 ${gst === '✓' ? 'text-green-400' : 'text-red-400'}`}>{gst}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h4 className="font-medium text-cyan-400 mt-3 mb-1">Public routes (no login)</h4>
                <p className="text-gray-300 text-sm"><code className="bg-white/10 px-1 rounded">/story/*</code> <code className="bg-white/10 px-1 rounded">/archive</code> <code className="bg-white/10 px-1 rounded">/games</code> <code className="bg-white/10 px-1 rounded">/privacy</code> <code className="bg-white/10 px-1 rounded">/terms</code> <code className="bg-white/10 px-1 rounded">/login</code></p>
                <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded text-sm">
                  <strong className="text-yellow-400">Note:</strong> No granular roles yet — all GitHub allowlist users are equivalent admins.
                </div>
              </AdminSection>
              <AdminSection
                title="Managing Guest PINs"
                is_open={open_doc === 'Managing Guest PINs'}
                on_toggle={() => set_open_doc(open_doc === 'Managing Guest PINs' ? null : 'Managing Guest PINs')}
              >
                <p className="mb-3">PINs let friends access the app without a GitHub account. Stored in Vercel env vars.</p>
                <h4 className="font-medium text-cyan-400 mt-3 mb-2">Add or change PINs</h4>
                <ol className="list-decimal list-inside space-y-1.5 text-gray-300 text-sm">
                  <li>Vercel Dashboard → <strong>8i11</strong> → Settings → Environment Variables</li>
                  <li>Find or create <code className="bg-white/10 px-1 rounded">GUEST_PINS</code></li>
                  <li>Set value: <code className="bg-white/10 px-1 rounded">mom1234,friend5678</code></li>
                  <li>Save → Deployments → ... → Redeploy</li>
                </ol>
                <p className="text-gray-300 text-sm mt-3">To revoke: remove their PIN and redeploy.</p>
                <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded text-sm">
                  <strong className="text-yellow-400">Note:</strong> Legacy <code className="bg-white/10 px-1 rounded">GUEST_PIN</code> still works alongside <code className="bg-white/10 px-1 rounded">GUEST_PINS</code>.
                </div>
              </AdminSection>
              <AdminSection
                title="Managing GitHub Users"
                is_open={open_doc === 'Managing GitHub Users'}
                on_toggle={() => set_open_doc(open_doc === 'Managing GitHub Users' ? null : 'Managing GitHub Users')}
              >
                <p className="mb-3">Default: only <code className="bg-white/10 px-1 rounded">boneshakerbike</code> can log in with GitHub.</p>
                <h4 className="font-medium text-cyan-400 mt-3 mb-2">Allow other GitHub users</h4>
                <ol className="list-decimal list-inside space-y-1.5 text-gray-300 text-sm">
                  <li>Vercel → Settings → Environment Variables</li>
                  <li>Create <code className="bg-white/10 px-1 rounded">ALLOWED_GITHUB_USERS</code></li>
                  <li>Value: comma-separated usernames — <code className="bg-white/10 px-1 rounded">boneshakerbike,frienduser</code></li>
                  <li>Save and redeploy</li>
                </ol>
              </AdminSection>
              <AdminSection
                title="Environment Variables Reference"
                is_open={open_doc === 'Environment Variables Reference'}
                on_toggle={() => set_open_doc(open_doc === 'Environment Variables Reference' ? null : 'Environment Variables Reference')}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left border-b border-white/10"><th className="py-2 pr-4 text-gray-400">Variable</th><th className="py-2 text-gray-400">Purpose</th></tr></thead>
                    <tbody className="text-gray-300">
                      {[
                        ['','Auth',''],
                        ['GUEST_PINS','Comma-separated guest PINs (agent + human access)',''],
                        ['GUEST_PIN','Legacy single PIN (still works)',''],
                        ['ALLOWED_GITHUB_USERS','Comma-separated GitHub login names allowed to authenticate',''],
                        ['GITHUB_CLIENT_ID','GitHub OAuth app ID',''],
                        ['GITHUB_CLIENT_SECRET','GitHub OAuth app secret',''],
                        ['NEXTAUTH_SECRET','Session encryption key',''],
                        ['','Database',''],
                        ['TURSO_DATABASE_URL','Production Turso (libSQL) database URL',''],
                        ['TURSO_AUTH_TOKEN','Production Turso auth token',''],
                        ['','AI & Integrations',''],
                        ['ANTHROPIC_API_KEY','Claude API key (stories, prompt review)',''],
                        ['OURA_CLIENT_ID','Oura Ring OAuth app ID',''],
                        ['OURA_CLIENT_SECRET','Oura Ring OAuth app secret',''],
                      ].map((row, i) => row[0] === '' ? (
                        <tr key={i}><td colSpan={2} className="py-2 pr-4 font-medium text-gray-400 pt-3">{row[1]}</td></tr>
                      ) : (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1.5 pr-4"><code className="text-cyan-400">{row[0]}</code></td>
                          <td className="py-1.5">{row[1]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AdminSection>
            </div>
          </div>
        )}

        {/* Services */}
        <div className="mb-10">
          <p className="text-xs uppercase tracking-widest text-gray-400 mb-4">Services</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

            {/* Vercel */}
            <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-xs">
              <div className="flex justify-between items-center mb-3">
                <span className="text-white font-medium">▲ Vercel</span>
                <a href="https://vercel.com/boneshakerbikes-projects/~/usage" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-cyan-400 transition-colors">Usage →</a>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><span className="text-gray-400">Bandwidth</span><span className="text-gray-300">100 GB/mo</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Build minutes</span><span className="text-gray-300">6,000/mo</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Functions</span><span className="text-gray-300">100 GB-hr/mo</span></div>
              </div>
            </div>

            {/* Turso */}
            <div className="p-4 rounded-xl border border-green-400/20 bg-white/5 text-xs">
              <div className="flex justify-between items-center mb-3">
                <span className="text-green-400 font-medium">◉ Turso</span>
                <a href="https://app.turso.tech" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-cyan-400 transition-colors">Dashboard →</a>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><span className="text-gray-400">Posts</span><span className="text-cyan-400 font-medium">{health ? health.posts.total.toLocaleString() : '—'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Stories</span><span className="text-cyan-400 font-medium">{health ? health.stories.total.toLocaleString() : '—'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Storage limit</span><span className="text-gray-300">9 GB</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Row reads</span><span className="text-gray-300">500M/mo</span></div>
              </div>
            </div>

            {/* Anthropic */}
            <div className="p-4 rounded-xl border border-purple-400/20 bg-white/5 text-xs">
              <div className="flex justify-between items-center mb-3">
                <span className="text-purple-400 font-medium">◆ Anthropic</span>
                <a href="https://console.anthropic.com/settings/cost" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-cyan-400 transition-colors">Usage →</a>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><span className="text-gray-400">Plan</span><span className="text-gray-300">Pay-as-you-go</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Story gen</span><span className="text-gray-300">~17¢/story</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Stories made</span><span className="text-cyan-400 font-medium">{health ? health.stories.total.toLocaleString() : '—'}</span></div>
              </div>
            </div>

          </div>
        </div>

        <footer className="text-center text-xs text-gray-400 border-t border-white/10 pt-6 pb-4">
          <div className="flex justify-center gap-4">
            <Link href="/privacy" className="hover:text-cyan-400 transition-colors">Privacy Policy</Link>
            <span className="text-gray-700">·</span>
            <Link href="/terms" className="hover:text-cyan-400 transition-colors">Terms of Service</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
