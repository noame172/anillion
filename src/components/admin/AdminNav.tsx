'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/admin', 'Analytics'],
  ['/admin/questions', 'Questions'],
  ['/admin/unknown', 'Unknown answers'],
  ['/admin/games', 'Daily games'],
  ['/admin/settings', 'Rarity & rules'],
  ['/admin/users', 'Users'],
  ['/admin/tools', 'Import & AI'],
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin">
      {LINKS.map(([href, label]) => {
        const active = href === '/admin' ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
