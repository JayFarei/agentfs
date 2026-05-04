// Adaptive sampling for the bootstrap pipeline.
//
// Per `kb/prd/design.md` §9.2, stage 2 of warm-up is "Sample: pull
// adaptive-size sample per collection (default 100, scales to 1000 on high
// field-presence variance)."
//
// Heuristic: pull 100 first; if presence variance across the observed
// fields is high (i.e., the schema is heterogenous), top up to 1000. We
// never pay for the larger sample on uniform-shaped collections.

import type { MountAdapter } from "../sdk/index.js";

export type CollectionSample = {
  collection: string;
  samples: unknown[];
};

export type SamplerOptions = {
  initialSize?: number;
  topupSize?: number;
  // Variance threshold above which we top up. Computed as the standard
  // deviation of field-presence frequencies. Empirically ~0.18 distinguishes
  // uniform (single-shape) from polymorphic collections.
  varianceThreshold?: number;
};

const DEFAULT_INITIAL = 100;
const DEFAULT_TOPUP = 1000;
const DEFAULT_VARIANCE_THRESHOLD = 0.18;

export async function sampleCollection(
  adapter: MountAdapter,
  collection: string,
  opts: SamplerOptions = {},
): Promise<CollectionSample> {
  const initial = opts.initialSize ?? DEFAULT_INITIAL;
  const topup = opts.topupSize ?? DEFAULT_TOPUP;
  const threshold = opts.varianceThreshold ?? DEFAULT_VARIANCE_THRESHOLD;

  const first = await adapter.sample(collection, { size: initial });
  if (first.length < initial) {
    // Tiny collection — no point topping up.
    return { collection, samples: first };
  }

  const variance = presenceVariance(first);
  if (variance < threshold) {
    return { collection, samples: first };
  }

  // Top up. We pull a fresh sample of `topup` rather than a delta because
  // $sample isn't idempotent across calls and we want the full population
  // statistics, not a stitched union.
  const second = await adapter.sample(collection, { size: topup });
  // If the larger sample didn't materially grow, prefer the larger of the two.
  return {
    collection,
    samples: second.length >= first.length ? second : first,
  };
}

// --- Helpers ----------------------------------------------------------------

// Compute the standard deviation of field-presence frequencies across the
// sample. A sample of N rows where every field is present in every row has
// variance 0; mixed shapes climb toward 0.5.
function presenceVariance(samples: unknown[]): number {
  if (samples.length === 0) return 0;

  const presence = new Map<string, number>();
  for (const doc of samples) {
    if (!isRecord(doc)) continue;
    const paths = enumerateTopLevelFields(doc);
    for (const path of paths) {
      presence.set(path, (presence.get(path) ?? 0) + 1);
    }
  }

  if (presence.size === 0) return 0;

  const total = samples.length;
  const freqs: number[] = [];
  for (const count of presence.values()) {
    freqs.push(count / total);
  }
  const mean = freqs.reduce((s, x) => s + x, 0) / freqs.length;
  const sqDev = freqs.reduce((s, x) => s + (x - mean) ** 2, 0) / freqs.length;
  return Math.sqrt(sqDev);
}

function enumerateTopLevelFields(obj: Record<string, unknown>): string[] {
  return Object.keys(obj);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
