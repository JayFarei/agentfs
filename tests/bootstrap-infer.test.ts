import { describe, expect, it } from "vitest";

import { inferShape, fingerprintDescriptor } from "../src/bootstrap/infer.js";

describe("inferShape — empty input", () => {
  it("returns a descriptor with rows=0 and no fields", () => {
    const out = inferShape({ collection: "x", samples: [] });
    expect(out.descriptor.cardinality.rows).toBe(0);
    expect(Object.keys(out.descriptor.fields)).toEqual([]);
    expect(out.descriptor.polymorphic_variants).toBeNull();
  });
});

describe("inferShape — field roles", () => {
  it('classifies a high-cardinality "id" string field as role="id"', () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({
      id: `case-${i}-${Math.random().toString(36).slice(2)}`,
      label: "x",
    }));
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.fields["id"]!.role).toBe("id");
  });

  it("classifies long string fields as role='text' and marks embeddable when mean length > 200", () => {
    const longText = "x".repeat(300);
    const samples = Array.from({ length: 5 }, () => ({ body: longText }));
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.fields["body"]!.role).toBe("text");
    expect(out.descriptor.fields["body"]!.embeddable).toBe(true);
  });

  it("does NOT mark short text fields as embeddable", () => {
    const samples = Array.from({ length: 5 }, (_, i) => ({
      title: `t${i}`,
    }));
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.fields["title"]!.embeddable).toBeUndefined();
  });

  it("classifies low-cardinality strings as role='label'", () => {
    const samples = ["A", "B", "A", "B", "A"].map((s) => ({ status: s }));
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.fields["status"]!.role).toBe("label");
  });

  it("classifies long number arrays as role='embedding'", () => {
    const big = Array.from({ length: 128 }, (_, i) => i);
    const samples = Array.from({ length: 3 }, () => ({ vec: big }));
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.fields["vec"]!.role).toBe("embedding");
  });

  it("classifies ISO date strings as role='timestamp'", () => {
    const samples = [
      { when: "2026-01-01" },
      { when: "2026-02-15T08:00:00Z" },
      { when: "2026-03-12" },
    ];
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.fields["when"]!.role).toBe("timestamp");
  });

  it("classifies plain numbers as role='number'", () => {
    const samples = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.fields["n"]!.role).toBe("number");
  });
});

describe("inferShape — presence frequencies", () => {
  it("computes presence as count / total per field", () => {
    const samples = [
      { a: 1, b: "x" },
      { a: 1 },
      { a: 1, b: "y" },
      {},
    ];
    const out = inferShape({ collection: "x", samples });
    expect(out.presence["a"]).toBe(0.75);
    expect(out.presence["b"]).toBe(0.5);
  });
});

describe("inferShape — polymorphism", () => {
  it("detects a 'kind' discriminator with two-or-more variants", () => {
    const samples = [
      { kind: "text", body: "hello" },
      { kind: "text", body: "world" },
      { kind: "table", rows: [1, 2, 3] },
      { kind: "table", rows: [4, 5] },
      { kind: "text", body: "again" },
    ];
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.polymorphic_variants).not.toBeNull();
    const variants = out.descriptor.polymorphic_variants!;
    const names = variants.map((v) => v.name).sort();
    expect(names).toEqual(["table", "text"]);
  });

  it("returns null when only one variant value exists", () => {
    const samples = [
      { kind: "uniform", a: 1 },
      { kind: "uniform", a: 2 },
    ];
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.polymorphic_variants).toBeNull();
  });

  it("returns null when no discriminator-shaped field is present", () => {
    const samples = [
      { name: "a", value: 1 },
      { name: "b", value: 2 },
    ];
    const out = inferShape({ collection: "x", samples });
    expect(out.descriptor.polymorphic_variants).toBeNull();
  });
});

describe("fingerprintDescriptor", () => {
  it("is deterministic over repeated calls", () => {
    const samples = [{ a: 1, b: "x" }, { a: 2, b: "y" }];
    const a = fingerprintDescriptor(inferShape({ collection: "x", samples }).descriptor);
    const b = fingerprintDescriptor(inferShape({ collection: "x", samples }).descriptor);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when the schema shape changes", () => {
    const a = fingerprintDescriptor(
      inferShape({ collection: "x", samples: [{ a: 1 }] }).descriptor,
    );
    const b = fingerprintDescriptor(
      inferShape({ collection: "x", samples: [{ a: 1, b: 2 }] }).descriptor,
    );
    expect(a).not.toBe(b);
  });

  it("does NOT change when only presence counts jitter slightly", () => {
    // Two sample sets with the same shape but different absolute counts:
    // both should bucket into the same presence bin.
    const samples1 = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const samples2 = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }];
    const f1 = fingerprintDescriptor(
      inferShape({ collection: "x", samples: samples1 }).descriptor,
    );
    const f2 = fingerprintDescriptor(
      inferShape({ collection: "x", samples: samples2 }).descriptor,
    );
    // Both have presence 1.0 for `a` so they bucket identically.
    expect(f1).toBe(f2);
  });
});
