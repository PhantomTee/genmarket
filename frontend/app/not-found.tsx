import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200">
        <Link href="/" className="text-xl font-bold tracking-tight text-neutral-900">
          GenMarket<span className="text-neutral-400">.</span>
        </Link>
      </nav>
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-4">
        <p className="text-7xl font-bold text-neutral-200">404</p>
        <h1 className="text-2xl font-bold text-neutral-900">Page not found</h1>
        <p className="text-neutral-500 text-sm max-w-xs">
          This page doesn&apos;t exist or the listing may have been removed.
        </p>
        <div className="flex gap-3 mt-2">
          <Link
            href="/"
            className="bg-neutral-900 text-[#F7F4EF] text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-neutral-700 transition-colors"
          >
            Go home
          </Link>
          <Link
            href="/browse"
            className="bg-white border border-neutral-200 text-neutral-900 text-sm font-semibold px-6 py-2.5 rounded-full hover:border-neutral-400 transition-colors"
          >
            Browse contracts
          </Link>
        </div>
      </div>
    </div>
  );
}
