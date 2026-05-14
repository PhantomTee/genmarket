import Link from 'next/link';
import Navbar from '../components/Navbar';
import ListingCard from '../components/ListingCard';
import { Listing } from '../lib/genlayer';

async function getFeaturedListings(): Promise<Listing[]> {
  try {
    const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backend) return [];
    const res = await fetch(`${backend}/api/listings`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const listings: Listing[] = Array.isArray(data) ? data : Array.isArray(data?.listings) ? data.listings : [];
    return listings.filter((l) => l.status === 'active').slice(0, 6);
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const listings = await getFeaturedListings();

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 md:py-36">
        <div className="inline-flex items-center gap-2 bg-neutral-900 dark:bg-neutral-100 text-[#F7F4EF] dark:text-neutral-900 text-xs font-medium px-4 py-1.5 rounded-full mb-8">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          Powered by GenLayer
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 leading-[1.05] mb-6 max-w-4xl">
          The marketplace for<br />
          <span className="text-neutral-400 dark:text-neutral-500">intelligent contracts.</span>
        </h1>
        <p className="text-lg text-neutral-500 dark:text-neutral-400 max-w-xl leading-relaxed mb-10">
          Buy and sell verified GenLayer contracts. Test live demos, get AI-powered code evaluation, and pay with escrow. All on-chain.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/browse"
            className="bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold px-8 py-3.5 rounded-full hover:bg-neutral-700 transition-colors text-sm"
          >
            Browse Code
          </Link>
          <Link
            href="/sell"
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 font-semibold px-8 py-3.5 rounded-full hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors text-sm"
          >
            Sell Your Code
          </Link>
          <Link
            href="/editor"
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 font-semibold px-8 py-3.5 rounded-full hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors text-sm"
          >
            Write Contract
          </Link>
        </div>
      </section>

      {/* Featured listings */}
      {listings.length > 0 && (
        <section className="px-6 md:px-12 py-16 border-t border-neutral-200 dark:border-neutral-700">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-baseline justify-between mb-8">
              <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Latest listings</h2>
              <Link href="/browse" className="text-sm text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors">
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
      <footer className="px-6 md:px-12 py-8 border-t border-neutral-200 dark:border-neutral-700">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">GenMarket.</span>
          <span className="text-xs text-neutral-400 dark:text-neutral-500">Built on GenLayer Studionet</span>
        </div>
      </footer>
    </div>
  );
}
