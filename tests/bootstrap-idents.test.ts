import { describe, expect, it } from "vitest";

import { toIdent, buildIdentMap } from "../src/bootstrap/idents.js";

describe("toIdent", () => {
  it.each([
    ["finqa_cases", "finqaCases"],
    ["finqa-cases", "finqaCases"],
    ["finqa.cases", "finqaCases"],
    ["FinQA_cases", "FinQACases"],
    ["cases", "cases"],
    ["multi_word_with_many_parts", "multiWordWithManyParts"],
  ])("toIdent(%j) === %j", (input, expected) => {
    expect(toIdent(input)).toBe(expected);
  });

  it("prefixes leading-digit names with underscore", () => {
    expect(toIdent("2024_revenue")).toBe("_2024Revenue");
    expect(toIdent("123abc")).toBe("_123abc");
  });

  it("camelCases names with leading or trailing underscores", () => {
    // The regex passes apply in this order:
    //   1. non-alphanum → "_"
    //   2. `_+([alphanum])` → uppercase the captured char (drops the `_`s)
    //   3. strip leading `_+`
    // For `_private_field`: step 2 turns `_p` and `_f` into `P` and `F`,
    // yielding `PrivateField`; step 3 has no leading `_` left to strip.
    // For `__seed__`: step 2 turns `__s` into `S`, leaving `Seed__`; the
    // trailing `__` has no alphanum to consume so it survives.
    expect(toIdent("_private_field")).toBe("PrivateField");
    expect(toIdent("__seed__")).toBe("Seed__");
  });

  it("falls back to 'item' for empty input or all-special-chars", () => {
    expect(toIdent("")).toBe("item");
    expect(toIdent("---")).toBe("item");
    expect(toIdent("___")).toBe("item");
  });

  it("preserves camelCase input as-is", () => {
    expect(toIdent("alreadyCamel")).toBe("alreadyCamel");
  });
});

describe("buildIdentMap", () => {
  it("returns one entry per input name preserving order", () => {
    const map = buildIdentMap(["finqa_cases", "finqa_search_units"]);
    expect(map).toEqual([
      { ident: "finqaCases", name: "finqa_cases" },
      { ident: "finqaSearchUnits", name: "finqa_search_units" },
    ]);
  });

  it("disambiguates ident collisions with numeric suffix", () => {
    const map = buildIdentMap(["foo_bar", "foo-bar", "foo.bar"]);
    expect(map).toEqual([
      { ident: "fooBar", name: "foo_bar" },
      { ident: "fooBar2", name: "foo-bar" },
      { ident: "fooBar3", name: "foo.bar" },
    ]);
  });

  it("does not disambiguate when names match exactly (idempotent on duplicates)", () => {
    const map = buildIdentMap(["x", "x"]);
    // The second "x" reuses the seen ident since the underlying name is
    // identical (no need to disambiguate against itself).
    expect(map[0]).toEqual({ ident: "x", name: "x" });
    expect(map[1]).toEqual({ ident: "x", name: "x" });
  });

  it("survives the empty-input case", () => {
    expect(buildIdentMap([])).toEqual([]);
  });
});
