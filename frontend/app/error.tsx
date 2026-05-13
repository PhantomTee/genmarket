'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App route error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-[#F7F4EF] dark:bg-[#0c0c0c]">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        Something went wrong
      </h1>

      <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-md">
        The page failed to load safely. This usually happens when a backend response or contract response has an unexpected shape.
      </p>

      <pre className="text-xs bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 max-w-lg overflow-auto text-left text-red-600">
        {error.message}
      </pre>

      <div className="flex gap-3">
        <button
          onClick={reset}
          className="bg-neutral-900 text-[#F7F4EF] px-5 py-2.5 rounded-xl text-sm font-semibold"
        >
          Try again
        </button>

        <Link
          href="/browse"
          className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 px-5 py-2.5 rounded-xl text-sm font-semibold"
        >
          Back to browse
        </Link>
      </div>
    </div>
  );
}
