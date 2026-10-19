import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = { title: 'Med.uz.ai — klinika boshqaruv platformasi', description: 'Med.uz.ai demo muhit · Sun’iy ma’lumotlar' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
