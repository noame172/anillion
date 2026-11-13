import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = { title: 'New password', robots: { index: false } };

/** Reached from the emailed reset link, after /auth/callback has signed the user in. */
export default function UpdatePasswordPage() {
  return <AuthForm mode="new-password" />;
}
