/** /coach moved to /health (Today); kept so old links and bookmarks still work. */

import { redirect } from 'next/navigation';

export default function CoachRedirect() {
  redirect('/health');
}
