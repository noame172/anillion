import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';
const adsOn = Boolean(process.env.NEXT_PUBLIC_ADSENSE_CLIENT);
const gaOn = Boolean(process.env.NEXT_PUBLIC_GA_ID);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

// Third-party hosts are only allowed when the matching integration is configured.
const scriptHosts = [
  adsOn ? 'https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net' : '',
  gaOn ? 'https://www.googletagmanager.com' : '',
].join(' ');
const connectHosts = [
  supabaseUrl,
  gaOn ? 'https://*.google-analytics.com https://*.analytics.google.com' : '',
  adsOn ? 'https://*.googlesyndication.com https://*.doubleclick.net' : '',
  'https://va.vercel-scripts.com',
].join(' ');
const frameHosts = adsOn ? 'https://*.doubleclick.net https://*.googlesyndication.com https://www.google.com' : '';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${dev ? "'unsafe-eval'" : ''} ${scriptHosts}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${connectHosts}`,
  `frame-src ${frameHosts || "'none'"}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp.replace(/\s+/g, ' ') },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
