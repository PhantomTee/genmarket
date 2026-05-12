import type { Metadata } from 'next';
import ListingClient from './ListingClient';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  try {
    const { id } = await params;
    const res = await fetch(`${BACKEND}/api/listings/${id}`, { cache: 'no-store' });
    if (!res.ok) return { title: 'Listing | GenMarket' };
    const listing = await res.json();
    return {
      title: `${listing.title} | GenMarket`,
      description: listing.description,
    };
  } catch {
    return { title: 'Listing | GenMarket' };
  }
}

export default async function ListingPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return <ListingClient id={id} />;
}
