/**
 * Private links: addresses on Bill's own Tailscale network (tailnet).
 *
 * These are reachable only from his devices with Tailscale on, never from the
 * public internet or from Vercel's servers. So the app only shows them as plain
 * links: no server-side check, proxy or embed, and no fetch or iframe from the
 * page either (they are plain http, which an https page blocks as mixed content;
 * Tailscale already encrypts the connection).
 *
 * This file is read only by /api/private-links, which answers admins only. Do not
 * import it from a client component: that would ship the addresses in the page's
 * JavaScript, where a guest could read them.
 *
 * To add a link, append an entry below. `backup_href` and `help` are optional.
 */

export interface PrivateLink {
  /** Short name shown on the link. */
  label: string;
  /** One line on what it is. */
  description: string;
  /** Main address, usually the device's Tailscale (MagicDNS) name. */
  href: string;
  /** Fallback address, usually the device's Tailscale IP, for when the name does not resolve. */
  backup_href?: string;
  /** Short "If it doesn't open" checklist, in the order to try. */
  help?: string[];
}

export const PRIVATE_LINKS: PrivateLink[] = [
  {
    label: 'Barely OS',
    description: 'My Chromebook home screen: photo frame, settings, apps',
    href: 'http://barely-os:8080',
    backup_href: 'http://100.93.219.51:8080',
    help: [
      'Tailscale app is on and connected on this device.',
      'The Chromebook is on, signed in, and hi has been run.',
      'Try the backup link.',
    ],
  },
];
