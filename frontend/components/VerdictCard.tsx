'use client';

export interface Verdict {
  verdict: 'match' | 'partial' | 'mismatch';
  confidence: number;
  explanation: string;
  caveats: string[];
}

interface Props {
  verdict: Verdict | null;
  loading: boolean;
}

const VERDICT_CONFIG = {
  match: {
    label: 'MATCH',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-800',
    bar: 'bg-emerald-500',
  },
  partial: {
    label: 'PARTIAL',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-800',
    bar: 'bg-amber-400',
  },
  mismatch: {
    label: 'MISMATCH',
    bg: 'bg-red-50',
    border: 'border-red-200',
    badge: 'bg-red-100 text-red-800',
    bar: 'bg-red-500',
  },
};

function LoadingSkeleton() {
  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-2xl p-5 flex flex-col gap-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-7 w-20 bg-neutral-100 dark:bg-neutral-800 rounded-full" />
        <div className="h-3 bg-neutral-100 dark:bg-neutral-800 rounded flex-1" />
      </div>
      <div className="h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full w-full" />
      <div className="space-y-2">
        <div className="h-3 bg-neutral-100 dark:bg-neutral-800 rounded w-full" />
        <div className="h-3 bg-neutral-100 dark:bg-neutral-800 rounded w-5/6" />
        <div className="h-3 bg-neutral-100 dark:bg-neutral-800 rounded w-4/6" />
      </div>
    </div>
  );
}

export default function VerdictCard({ verdict, loading }: Props) {
  if (loading) return <LoadingSkeleton />;
  if (!verdict) return null;

  const cfg =
    VERDICT_CONFIG[verdict.verdict as keyof typeof VERDICT_CONFIG] ??
    VERDICT_CONFIG.partial;

  const caveats = verdict.caveats || [];

  return (
    <div className={`border ${cfg.border} ${cfg.bg} rounded-2xl p-5 flex flex-col gap-4`}>
      {/* Badge + confidence */}
      <div className="flex items-center gap-3">
        <span className={`text-xs font-bold px-3 py-1 rounded-full tracking-widest ${cfg.badge}`}>
          {cfg.label}
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
          {verdict.confidence}% confidence
        </span>
      </div>

      {/* Confidence bar */}
      <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${cfg.bar}`}
          style={{ width: `${verdict.confidence}%` }}
        />
      </div>

      {/* Explanation */}
      <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">{verdict.explanation}</p>

      {/* Caveats */}
      {caveats.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">
            Caveats
          </p>
          <ul className="flex flex-col gap-1.5">
            {caveats.map((c, i) => (
              <li key={i} className="flex gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <span className="mt-0.5 shrink-0 text-neutral-400 dark:text-neutral-500">·</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
