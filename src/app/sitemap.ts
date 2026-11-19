import type { MetadataRoute } from 'next';

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, MetadataRoute.Sitemap[number]['changeFrequency'], number][] = [
    ['/', 'daily', 1],
    ['/leaderboard', 'hourly', 0.7],
    ['/how-to-play', 'monthly', 0.6],
    ['/tips', 'monthly', 0.6],
    ['/faq', 'monthly', 0.6],
    ['/anime-quiz-questions', 'weekly', 0.6],
  ];
  return pages.map(([path, changeFrequency, priority]) => ({ url: `${siteUrl}${path}`, changeFrequency, priority }));
}
