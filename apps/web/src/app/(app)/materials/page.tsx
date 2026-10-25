'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { Button, Card, PageHeader } from '@/components/ui';
import { RequestModal } from '@/components/warehouse/request-modal';
import { RequestsList } from '@/components/warehouse/requests';
import { useDocBranch } from '@/components/warehouse/docs';

/** Doctor / lab: my own material requests. A doctor may also pick one of their own recent visits (the visit's ICD-10 codes come with it). */
export default function MaterialsPage() {
  const t = useT();
  const { me } = useSession();
  const branch = useDocBranch();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title={t('wh.mine.title')} subtitle={me.role === 'doctor' ? t('wh.mine.subtitle') : undefined}
        actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>{t('wh.mine.new')}</Button>} />
      <Card padded={false}><div className="pt-2"><RequestsList mine /></div></Card>
      {open && <RequestModal open branchId={branch} allowPatient={me.role === 'doctor'} onClose={() => setOpen(false)} />}
    </>
  );
}
