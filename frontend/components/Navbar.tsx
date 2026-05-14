'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';

/**
 * Shared navigation bar used across all pages.
 * Includes a hamburger menu for mobile screens.
 */
export default function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the menu whenever the route changes
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const links = [
    { href: '/browse',    label: 'Browse' },
    { href: '/sell',      label: 'Sell' },
    { href: '/purchases', label: 'Recent' },
    { href: '/editor',    label: 'Editor' },
    { href: '/dashboard', label: 'Dashboard' },
  ];

  function isActive(href: string) {
    return pathname === href || (href !== '/' && pathname.startsWith(href));
  }

  return (
    <nav className="sticky top-0 z-10 bg-[#F7F4EF] dark:bg-[#0c0c0c] border-b border-neutral-200 dark:border-neutral-700">
      {/* Main bar */}
      <div className="flex items-center justify-between px-6 md:px-12 py-5">
        <Link
          href="/"
          className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100"
        >
          GenMarket<span className="text-neutral-400 dark:text-neutral-500">.</span>
        </Link>

        <div className="flex items-center gap-4 sm:gap-6">
          {/* Desktop links */}
          <div className="hidden sm:flex items-center gap-6">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`text-sm transition-colors ${
                  isActive(href)
                    ? 'text-neutral-900 dark:text-neutral-100 font-medium'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          <WalletConnect />

          {/* Mobile hamburger button */}
          <button
            className="sm:hidden flex flex-col justify-center items-center gap-1.5 w-8 h-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <span className={`block w-5 h-0.5 bg-neutral-700 dark:bg-neutral-300 transition-all duration-200 ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-5 h-0.5 bg-neutral-700 dark:bg-neutral-300 transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-neutral-700 dark:bg-neutral-300 transition-all duration-200 ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="sm:hidden border-t border-neutral-200 dark:border-neutral-700 bg-[#F7F4EF] dark:bg-[#0c0c0c] px-6 py-4 flex flex-col gap-1">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`text-sm py-2.5 border-b border-neutral-100 dark:border-neutral-800 last:border-0 transition-colors ${
                isActive(href)
                  ? 'text-neutral-900 dark:text-neutral-100 font-medium'
                  : 'text-neutral-500 dark:text-neutral-400'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

