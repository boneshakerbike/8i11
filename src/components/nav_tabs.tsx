/**
 * NavTabs - Main navigation header
 * Desktop (md+): Radix UI horizontal dropdown bar — Home | Creative | Tools | Health | Games | Weather.
 * Mobile (< md): hamburger -> single-open accordion drawer (same link sets).
 * Wordmark "8i11" shown in the header at all breakpoints.
 * Tools dropdown/group sourced from src/lib/tools.ts; section accents from src/lib/sections.ts.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { TOOLS } from '@/lib/tools';
import { SECTION_ACCENTS } from '@/lib/sections';

interface NavTabsProps {
  theme?: 'dark' | 'light';
}

interface NavItem {
  label: string;
  href: string;
}

export default function NavTabs({ theme = 'dark' }: NavTabsProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const mobile_ref = useRef<HTMLElement>(null);
  const hamburger_ref = useRef<HTMLButtonElement>(null);
  const [is_local, set_is_local] = useState(false);
  const [menu_open, set_menu_open] = useState(false);
  const [open_nav, set_open_nav] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe: window only accessible client-side
  useEffect(() => { set_is_local(window.location.hostname === 'localhost'); }, []);

  const is_light = theme === 'light';
  const is_guest = (session?.user as { id?: string })?.id === 'guest';
  const show_coach = !!session && !is_guest;

  // Escape to close (return focus to hamburger) + click outside to close
  useEffect(() => {
    if (!menu_open) return;
    const on_key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { set_menu_open(false); hamburger_ref.current?.focus(); }
    };
    const on_pointer = (e: PointerEvent) => {
      if (mobile_ref.current && !mobile_ref.current.contains(e.target as Node)) set_menu_open(false);
    };
    document.addEventListener('keydown', on_key);
    document.addEventListener('pointerdown', on_pointer);
    return () => {
      document.removeEventListener('keydown', on_key);
      document.removeEventListener('pointerdown', on_pointer);
    };
  }, [menu_open]);

  const is_active = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  // --- Shared link sets (Tools is data-driven; Coach is auth-gated) ---
  const creative_items: NavItem[] = [
    { label: 'On This Day', href: '/creative' },
    { label: 'Archive', href: '/creative/archive' },
    { label: 'Say What?', href: '/creative/text-cleaner' },
  ];
  const tools_items: NavItem[] = TOOLS.map((t) => ({ label: t.label, href: t.path }));
  const health_items: NavItem[] = [
    ...(show_coach ? [{ label: 'Today', href: '/health' }, { label: 'Trends', href: '/health/trends' }] : []),
    { label: 'Oura', href: '/health/oura' },
    { label: 'COROS', href: '/health/coros' },
    { label: 'Ride with GPS', href: '/health/ridewithgps' },
  ];
  const games_items: NavItem[] = [
    { label: 'Frogger', href: '/games/frogger' },
    { label: 'Breakout', href: '/games/breakout' },
    { label: 'F1 Predictions', href: '/games/f1' },
  ];

  const nav_groups: { label: string; base: string; items: NavItem[] }[] = [
    { label: 'Creative', base: '/creative', items: creative_items },
    { label: 'Tools', base: '/tools', items: tools_items },
    { label: 'Health', base: '/health', items: health_items },
    { label: 'Games', base: '/games', items: games_items },
  ];

  // ---------- Desktop (md+) styles ----------
  const tab_class = (path: string) => {
    const base = 'px-4 sm:px-3 py-3 sm:py-2 text-base sm:text-sm min-h-[44px] sm:min-h-0 font-medium transition-all border-b-2 whitespace-nowrap';
    if (is_active(path)) {
      return `${base} ${is_light ? 'text-[#c4704b] border-[#c4704b]' : 'text-cyan-400 border-cyan-400'}`;
    }
    return `${base} ${is_light ? 'text-gray-500 border-transparent hover:text-[#c4704b] hover:border-[#c4704b]/50' : 'text-gray-200 border-transparent hover:text-cyan-400 hover:border-cyan-400/50'}`;
  };

  const content_class = `rounded-lg shadow-xl min-w-[180px] py-1 z-[9999] ${is_light ? 'bg-white border border-[#e5e0d8]' : 'bg-[#1a1a2e] border border-white/10'}`;

  const item_class = `block px-4 py-3 sm:py-2 text-base sm:text-sm min-h-[44px] sm:min-h-0 transition-all cursor-pointer outline-none ${is_light ? 'text-gray-600 hover:bg-[#c4704b]/10 hover:text-[#c4704b] focus:bg-[#c4704b]/10 focus:text-[#c4704b]' : 'text-gray-200 hover:bg-cyan-400/10 hover:text-cyan-400 focus:bg-cyan-400/10 focus:text-cyan-400'}`;

  // Chevron rotates via group-data-[state=open] — Radix sets data-state on the Trigger
  const chevron_svg = (
    <svg
      className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );

  const trigger_class = (path: string) =>
    `group bg-transparent outline-none focus:outline-none focus-visible:outline-none ${tab_class(path)} flex items-center gap-1`;

  const desktop_dropdown = (label: string, base: string, items: NavItem[], extra_content_class = '') => (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={trigger_class(base)}>
          {label} {chevron_svg}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={`${content_class} ${extra_content_class}`} sideOffset={4} align="start" avoidCollisions>
          {items.map((it) => (
            <DropdownMenu.Item key={it.href} asChild>
              <Link href={it.href} className={item_class}>{it.label}</Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  // ---------- Mobile (< md) drawer styles ----------
  const wordmark_color = is_light ? 'text-[#c4704b]' : 'text-cyan-400';
  // Per-section accent: dark = section hue; light = single terracotta.
  const group_accent = (label: string) => (is_light ? '#c4704b' : SECTION_ACCENTS[label]);

  const drawer_link_class = (path: string) => {
    const base = 'flex items-center w-full text-left px-4 py-3 rounded-lg text-base font-semibold min-h-[44px] transition-colors';
    if (is_active(path)) return `${base} ${is_light ? 'text-[#c4704b]' : 'text-cyan-400'}`;
    return `${base} ${is_light ? 'text-gray-700 hover:text-[#c4704b]' : 'text-gray-200 hover:text-white'}`;
  };

  return (
    <header ref={mobile_ref} className={`relative mb-6 border-b ${is_light ? 'border-[#e5e0d8]' : 'border-white/10'}`}>
      <div className="flex items-center justify-between gap-3">
        {/* Left cluster: hamburger (mobile) + wordmark + desktop nav */}
        <div className="flex items-center min-w-0 flex-1 gap-2">
          {/* Hamburger — mobile only */}
          <button
            ref={hamburger_ref}
            type="button"
            onClick={() => set_menu_open((o) => !o)}
            aria-label={menu_open ? 'Close menu' : 'Open menu'}
            aria-expanded={menu_open}
            aria-controls="mobile-nav-drawer"
            className={`md:hidden flex flex-col items-center justify-center gap-[4px] w-10 h-10 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${is_light ? 'focus-visible:outline-[#c4704b]' : 'focus-visible:outline-cyan-400'}`}
          >
            <span className={`w-[18px] h-[2px] rounded-full ${is_light ? 'bg-gray-600' : 'bg-gray-200'}`} />
            <span className={`w-[18px] h-[2px] rounded-full ${is_light ? 'bg-gray-600' : 'bg-gray-200'}`} />
            <span className={`w-[18px] h-[2px] rounded-full ${is_light ? 'bg-gray-600' : 'bg-gray-200'}`} />
          </button>

          {/* Wordmark — all breakpoints */}
          <Link href="/" className={`text-2xl md:text-xl font-extrabold tracking-tight ${wordmark_color} mr-1`}>
            8i11
          </Link>

          {/* Desktop nav — md+ only */}
          <nav className="hidden md:flex items-center overflow-x-auto scrollbar-hide">
            <Link href="/" className={tab_class('/')}>Home</Link>
            {desktop_dropdown('Creative', '/creative', creative_items)}
            {desktop_dropdown('Tools', '/tools', tools_items)}
            {desktop_dropdown('Health', '/health', health_items)}
            {desktop_dropdown('Games', '/games', games_items, 'min-w-[150px]')}
            <Link href="/weather" className={tab_class('/weather')}>Weather</Link>
          </nav>
        </div>

        {/* Right: user cluster — desktop only (mobile shows it in the drawer) */}
        <div className="hidden md:flex items-center whitespace-nowrap ml-4">
          {is_local && (
            <a
              href="http://localhost:8080"
              className={`text-xs mr-3 ${is_light ? 'text-gray-400 hover:text-[#c4704b]' : 'text-gray-500 hover:text-cyan-400'}`}
            >
              Dev Hub
            </a>
          )}
          {session && (
            <div className={`text-xs pr-1 ${is_light ? 'text-gray-500' : 'text-gray-400'}`}>
              <span className="hidden sm:inline">{session.user?.name || session.user?.email || 'Guest'}</span>
              <button
                onClick={() => signOut()}
                className={`ml-2 underline ${is_light ? 'text-gray-500 hover:text-[#c4704b]' : 'text-gray-400 hover:text-cyan-400'}`}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile drawer — < md only */}
      {menu_open && (
        <div
          id="mobile-nav-drawer"
          className={`md:hidden absolute top-full left-0 right-0 z-[9999] mt-px max-h-[70vh] overflow-y-auto p-2 rounded-b-xl shadow-[0_16px_40px_rgba(0,0,0,0.5)] border-b ${is_light ? 'bg-white/95 backdrop-blur-md border-[#e5e0d8]' : 'bg-[#0d1326]/98 backdrop-blur-md border-white/10'}`}
        >
          {/* Home (direct link) */}
          <Link href="/" onClick={() => set_menu_open(false)} className={drawer_link_class('/')}>Home</Link>

          {/* Groups */}
          {nav_groups.map((g) => {
            const open = open_nav === g.label;
            const active = is_active(g.base);
            return (
              <div key={g.label}>
                <button
                  type="button"
                  onClick={() => set_open_nav((cur) => (cur === g.label ? null : g.label))}
                  aria-expanded={open}
                  className="flex items-center w-full text-left px-4 py-3 rounded-lg text-base font-semibold min-h-[44px]"
                  style={{ color: active || open ? group_accent(g.label) : undefined }}
                >
                  <span className="flex-1" style={{ color: group_accent(g.label) }}>{g.label}</span>
                  <span className={`text-xs transition-transform ${is_light ? 'text-gray-400' : 'text-gray-500'} ${open ? 'rotate-90' : ''}`}>▸</span>
                </button>
                {open && (
                  <div className="pb-2">
                    {g.items.map((it) => (
                      <Link
                        key={it.href}
                        href={it.href}
                        onClick={() => set_menu_open(false)}
                        className={`block w-full text-left pl-7 pr-4 py-2.5 text-[15px] min-h-[44px] transition-colors ${(it.href === g.base ? pathname === it.href : is_active(it.href)) ? (is_light ? 'text-[#c4704b]' : 'text-cyan-400') : (is_light ? 'text-gray-600 hover:text-[#c4704b]' : 'text-gray-300 hover:text-white')}`}
                      >
                        {it.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Weather (direct link) */}
          <Link href="/weather" onClick={() => set_menu_open(false)} className={drawer_link_class('/weather')}>Weather</Link>

          {/* Account cluster */}
          <div className={`mt-2 mx-2 border-t ${is_light ? 'border-[#e5e0d8]' : 'border-white/10'}`} />
          <div className="flex items-center justify-between px-4 py-3">
            <div className={`text-xs ${is_light ? 'text-gray-500' : 'text-gray-400'}`}>
              {is_local && (
                <a href="http://localhost:8080" className={`mr-3 ${is_light ? 'hover:text-[#c4704b]' : 'hover:text-cyan-400'}`}>Dev Hub</a>
              )}
              {session && (
                <span>{session.user?.name || session.user?.email || 'Guest'}</span>
              )}
            </div>
            {session && (
              <button
                onClick={() => signOut()}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${is_light ? 'border-red-400/40 text-red-500' : 'border-red-400/40 text-red-400'}`}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
