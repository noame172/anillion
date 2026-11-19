import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
import { config } from '@/lib/config';

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
      {(error === 'google' || error === 'google-off') && (
        <p className="notice warn narrow" role="alert">
          {error === 'google'
            ? 'Google sign-in did not complete. Try again, or log in with your password.'
            : 'Google sign-in is not set up on this site yet.'}
        </p>
      )}
      <AuthForm mode="login" google={config.googleLogin} hideGoogle={config.mode === 'supabase' && !config.googleLogin} />
    </>
  );
}
