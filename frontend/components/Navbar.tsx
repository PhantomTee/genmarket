'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';

/**
 * Shared navigation bar used across all pages.
 * Each page previously had its own inline nav with inconsistent links —
 * this component centralises them and ensures Dashboard always appears.
 *
 * Usage: import Navbar from '../../components/Navbar';
 *        <Navbar />
 *
 * The sticky + z-10 classes mirror what ListingClient uses so behaviour
 * is consistent on all pages.
 */
export default function Navbar() {
  const pathname = usePathname();

  const links = [
    { href: '/browse',    label: 'Browse' },
    { href: '/sell',      label: 'Sell' },
    { href: '/purchases', label: 'Recent' },
    { href: '/editor',    label: 'Editor' },
    { href: '/dashboard', label: 'Dashboard' },
  ];

  return (
    <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200 dark:border-neutral-700 sticky top-0 bg-[#F7F4EF] dark:bg-[#0c0c0c] z-10">
      <Link
        href="/"
        className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100"
      >
        GenMarket<span className="text-neutral-400 dark:text-neutral-500">.</span>
      </Link>

      <div className="flex items-center gap-4 sm:gap-6">
        <div className="hidden sm:flex items-center gap-6">
          {links.map(({ href, label }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`text-sm transition-colors ${
                  active
                    ? 'text-neutral-900 dark:text-neutral-100 font-medium'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
        <WalletConnect />
      </div>
    </nav>
  );
}
