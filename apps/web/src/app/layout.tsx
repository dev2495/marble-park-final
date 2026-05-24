import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Marble Park | Premium Bath Solutions',
  description: 'Marble Park - Premium Bath Solutions CRM & Inventory Management',
};

/**
 * Inline theme bootstrap. Runs *before* the body renders so the saved
 * preference is applied without a flash of light-content on dark-mode page
 * loads. Reads `mp_theme` from localStorage (`light` | `dark` | `system`)
 * and adds `.dark` to <html> when appropriate.
 */
const THEME_INIT = `
(function(){
  try {
    var html = document.documentElement;
    html.classList.add('preload');
    var m = localStorage.getItem('mp_theme') || 'system';
    var dark = m === 'dark' || (m === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) html.classList.add('dark');
    // Strip 'preload' on the next animation frame — it disables the global
    // color/border transition just long enough for the initial paint to
    // finish with the right tokens, so the page never animates *in* from
    // light to dark on first load.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { html.classList.remove('preload'); });
    });
  } catch (e) {}
})();
`.trim();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
