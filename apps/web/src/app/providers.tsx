'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ToastProvider } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n';
import type { Locale } from '@meduza/contracts';

export function Providers({ children, initialLocale }: { children: React.ReactNode; initialLocale: Locale }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      // networkMode 'always': when the connection is down requests fail visibly instead of being silently paused.
      queries: { networkMode: 'always', staleTime: 5_000, refetchOnWindowFocus: true, retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2 },
      mutations: { retry: false, networkMode: 'always' },
    },
  }));
  return <QueryClientProvider client={client}><I18nProvider initialLocale={initialLocale}><ToastProvider>{children}</ToastProvider></I18nProvider></QueryClientProvider>;
}
