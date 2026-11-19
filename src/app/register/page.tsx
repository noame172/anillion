import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Create account', robots: { index: false } };

export default function RegisterPage() {
  return <AuthForm mode="register" google={config.googleLogin} hideGoogle={config.mode === 'supabase' && !config.googleLogin} />;
}
