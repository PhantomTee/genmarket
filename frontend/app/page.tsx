import Link from 'next/link';
import WalletConnect from '../components/WalletConnect';
import ListingCard from '../components/ListingCard';
import { Listing } from '../lib/genlayer';

async function getFeaturedListings(): Promise<Listing[]> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'}/api/listings`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const listings: Listing[] = await res.json();
    return listings.filter((l) => l.status === 'active').slice(0, 6);
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const listings = await getFeaturedListings();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200">
        <Link href="/" className="text-xl font-bold tracking-tight text-neutral-900">
          GenMarket<span className="text-neutral-400">.</span>
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="hidden sm:flex items-center gap-6">
            <Link href="/browse" className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors">Browse</Link>
            <Link href="/sell" className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors">Sell</Link>
            <Link href="/editor" className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors">Editor</Link>
          </div>
          <WalletConnect />
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 md:py-36">
        <div className="inline-flex items-center gap-2 bg-neutral-900 text-[#F7F4EF] text-xs font-medium px-4 py-1.5 rounded-full mb-8">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          Powered by GenLayer
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight text-neutral-900 leading-[1.05] mb-6 max-w-4xl">
          The marketplace for<br />
          <span className="text-neutral-400">intelligent contracts.</span>
        </h1>
        <p className="text-lg text-neutral-500 max-w-xl leading-relaxed mb-10">
          Buy and sell verified GenLayer contracts. Test live demos, get AI-powered code evaluation, and pay with escrow. All on-chain.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/browse"
            className="bg-neutral-900 text-[#F7F4EF] font-semibold px-8 py-3.5 rounded-full hover:bg-neutral-700 transition-colors text-sm"
          >
            Browse Code
          </Link>
          <Link
            href="/sell"
            className="bg-white border border-neutral-200 text-neutral-900 font-semibold px-8 py-3.5 rounded-full hover:border-neutral-400 transition-colors text-sm"
          >
            Sell Your Code
          </Link>
          <Link
            href="/editor"
            className="bg-white border border-neutral-200 text-neutral-900 font-semibold px-8 py-3.5 rounded-full hover:border-neutral-400 transition-colors text-sm"
          >
            Write Contract
          </Link>
        </div>
      </section>

      {/* Featured listings */}
      {listings.length > 0 && (
        <section className="px-6 md:px-12 py-16 border-t border-neutral-200">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-baseline justify-between mb-8">
              <h2 className="text-2xl font-bold text-neutral-900">Latest listings</h2>
              <Link href="/browse" className="text-sm text-neutral-400 hover:text-neutral-900 transition-colors">
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {listings.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="px-6 md:px-12 py-8 border-t border-neutral-200">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-sm font-bold text-neutral-900">GenMarket.</span>
          <span className="text-xs text-neutral-400">Built on GenLayer Studionet</span>
        </div>
      </footer>
    </div>
  );
}
