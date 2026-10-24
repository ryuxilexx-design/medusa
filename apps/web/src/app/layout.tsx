import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import '@fontsource-variable/golos-text';
import './globals.css';
import { isLocale, LOCALE_TAG, type Locale } from '@meduza/contracts';
import { Providers } from './providers';
import { GlassDefs } from '@/components/glass';

// no static title here: each screen renders its own <title> («<page> — Med.uz.ai», in the reader's language)
export const metadata: Metadata = { description: 'Med.uz.ai demo muhit · Sun’iy ma’lumotlar' };
// viewport-fit=cover: the phone tab bar reads env(safe-area-inset-bottom) and floats above the iPhone home indicator
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // the language chosen before (cookie, UI preference only) renders on the first paint — no flash of another language
  const c = (await cookies()).get('meduza_lang')?.value;
  const locale: Locale = isLocale(c) ? c : 'uz';
  return (
    <html lang={LOCALE_TAG[locale]}>
      <body><GlassDefs /><Providers initialLocale={locale}>{children}</Providers></body>
    </html>
  );
}
