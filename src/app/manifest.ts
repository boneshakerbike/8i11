/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * Without one, Chrome's "Install page as app" uses whatever page is open as the
 * start URL, so installing from /login made every launch open the login form.
 * The proxy must let this file and its icons through: Chrome fetches the
 * manifest without cookies, so a redirect to /login would make it ignore it.
 */

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '8i11',
    short_name: '8i11',
    description: 'Creative tools and games by William Martin',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#1a1a2e',
    theme_color: '#1a1a2e',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
