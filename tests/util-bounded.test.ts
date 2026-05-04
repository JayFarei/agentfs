import { describe, expect, it } from "vitest";

import { enforceMapCap } from "../src/util/bounded.js";

describe("enforceMapCap", () => {
  it("is a no-op when the map is at or below the cap", () => {
    const m = new Map<string, number>([["a", 1], ["b", 2]]);
    enforceMapCap(m, 5);
    expect(Array.from(m.keys())).toEqual(["a", "b"]);
  });

  it("evicts oldest entries (insertion order) until size <= cap", () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 10; i += 1) m.set(`k${i}`, i);
    enforceMapCap(m, 3);
    expect(m.size).toBe(3);
    expect(Array.from(m.keys())).toEqual(["k7", "k8", "k9"]);
  });

  it("calls onEvict with the evicted key + value", () => {
    const evicted: Array<[string, number]> = [];
    const m = new Map<string, number>([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    enforceMapCap(m, 2, (k, v) => evicted.push([k, v]));
    expect(evicted).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(Array.from(m.keys())).toEqual(["c", "d"]);
  });

  it("treats a delete-then-set as a touch (move-to-back)", () => {
    const m = new Map<string, number>();
    m.set("a", 1);
    m.set("b", 2);
    m.set("c", 3);
    // Touch "a" by deleting + re-inserting
    const v = m.get("a")!;
    m.delete("a");
    m.set("a", v);
    enforceMapCap(m, 2);
    // "b" should be evicted (now oldest), not "a"
    expect(Array.from(m.keys())).toEqual(["c", "a"]);
  });

  it("handles cap = 0 by clearing the map", () => {
    const m = new Map<string, number>([["a", 1]]);
    enforceMapCap(m, 0);
    expect(m.size).toBe(0);
  });
});
