import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = { title: 'Log in', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      {error === 'link' && (
        <p className="notice warn narrow" role="alert">
          That link is invalid or has expired. Log in or request a new one.
        </p>
      )}
      <AuthForm mode="login" />
    </>
  );
}
