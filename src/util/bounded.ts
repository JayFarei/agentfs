// Bounded-map helper. The data plane has several long-lived caches
// (per-trajectory, per-tenant, per-/lib/-file). Without a cap they
// accumulate one entry per request and leak slowly; in dev/test this is
// invisible, in a long-lived process it adds up. Each cache calls
// `enforceMapCap` after insert with its size budget; entries evict in
// insertion (FIFO) order.

/**
 * Enforce a maximum size on a Map by evicting the oldest entries
 * (insertion order — the V8 Map preserves it). Calls `onEvict` for each
 * evicted entry, useful for releasing tied resources (e.g. a Flue agent
 * session) before dropping the entry.
 *
 * Cheap: O(overflow). When the map is at or below the cap, this is a
 * single size check and a return.
 */
export function enforceMapCap<K, V>(
  map: Map<K, V>,
  max: number,
  onEvict?: (key: K, value: V) => void,
): void {
  while (map.size > max) {
    const it = map.keys().next();
    if (it.done) return;
    const key = it.value;
    if (onEvict !== undefined) {
      const value = map.get(key);
      if (value !== undefined) onEvict(key, value);
    }
    map.delete(key);
  }
}
