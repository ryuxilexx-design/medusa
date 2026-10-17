'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HOME_BY_ROLE, useMeQuery } from '@/lib/session';
import { Loader2 } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const me = useMeQuery();
  useEffect(() => {
    if (me.data) router.replace(HOME_BY_ROLE[me.data.role]);
    else if (me.isError) router.replace('/login');
  }, [me.data, me.isError, router]);
  return <div className="flex h-screen items-center justify-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>;
}
