import Link from 'next/link';
import { Listing } from '../lib/genlayer';
import { formatGEN } from '../lib/encryption';

const CATEGORY_COLORS: Record<string, string> = {
  DeFi:         'bg-emerald-100 text-emerald-800',
  NFT:          'bg-purple-100 text-purple-800',
  DAO:          'bg-blue-100 text-blue-800',
  Oracle:       'bg-amber-100 text-amber-800',
  Identity:     'bg-rose-100 text-rose-800',
  Utility:      'bg-stone-100 text-stone-700',
};

function categoryClass(category: string) {
  return CATEGORY_COLORS[category] ?? 'bg-stone-100 text-stone-700';
}

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Props {
  listing: Listing;
}

export default function ListingCard({ listing }: Props) {
  return (
    <div className="group border border-neutral-200 bg-white rounded-2xl p-5 flex flex-col gap-4 hover:border-neutral-900 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-neutral-900 text-base leading-snug line-clamp-2 flex-1">
          {listing.title}
        </h3>
        <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${categoryClass(listing.category)}`}>
          {listing.category}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-neutral-500 line-clamp-3 leading-relaxed flex-1">
        {listing.description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-neutral-100">
        <div>
          <p className="text-xs text-neutral-400 mb-0.5">Seller</p>
          <p className="font-mono text-xs text-neutral-600">{truncateAddress(listing.seller)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-neutral-400 mb-0.5">Price</p>
          <p className="font-semibold text-neutral-900 text-sm">{formatGEN(listing.price)}</p>
        </div>
      </div>

      <Link
        href={`/listing/${listing.id}`}
        className="block w-full text-center bg-neutral-900 text-[#F7F4EF] text-sm font-medium py-2.5 rounded-xl hover:bg-neutral-700 transition-colors"
      >
        View Listing
      </Link>
    </div>
  );
}
