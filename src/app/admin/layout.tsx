import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminNav } from '@/components/admin/AdminNav';
import { getUserViewer } from '@/lib/auth/viewer';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Server-side gate for every /admin page. Anyone who is not an administrator
 * gets the ordinary 404 page, so the dashboard's existence is not revealed.
 * The admin API enforces the same check independently.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getUserViewer().catch(() => null);
  if (!user || user.role !== 'admin') notFound();
  return (
    <div className="admin">
      <AdminNav />
      <div>{children}</div>
    </div>
  );
}
