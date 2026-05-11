import { describe, expect, it } from "vitest";

import { buildAutoInvokeTrailer } from "../src/snippet/runtime.js";

describe("buildAutoInvokeTrailer", () => {
  it("returns empty string when no entry-point names are declared", () => {
    const body = `
const cocktails: string[] = [];
console.log(cocktails);
`;
    expect(buildAutoInvokeTrailer(body)).toBe("");
  });

  it("returns empty string when main is declared and invoked via top-level call", () => {
    const body = `
async function main() {
  console.log("hi");
}

main();
`;
    expect(buildAutoInvokeTrailer(body)).toBe("");
  });

  it("returns empty string when main is invoked via return main()", () => {
    const body = `
async function main() { return 1; }
return main();
`;
    expect(buildAutoInvokeTrailer(body)).toBe("");
  });

  it("returns empty string when main is invoked via await main()", () => {
    const body = `
async function main() { return 1; }
await main();
`;
    expect(buildAutoInvokeTrailer(body)).toBe("");
  });

  it("emits an auto-invoke trailer when main is declared but never called", () => {
    const body = `
async function main() {
  console.log("hi");
}
`;
    const trailer = buildAutoInvokeTrailer(body);
    expect(trailer).toContain('typeof main === "function"');
    expect(trailer).toContain("await main()");
    expect(trailer).toContain("auto-invoking main()");
  });

  it("emits an auto-invoke trailer for run() entry-point", () => {
    const body = `
async function run() {
  return 42;
}
`;
    const trailer = buildAutoInvokeTrailer(body);
    expect(trailer).toContain('typeof run === "function"');
    expect(trailer).toContain("await run()");
  });

  it("emits an auto-invoke trailer for solve() entry-point", () => {
    const body = `
async function solve() {
  return 7;
}
`;
    const trailer = buildAutoInvokeTrailer(body);
    expect(trailer).toContain('typeof solve === "function"');
  });

  it("does not double-invoke when main contains nested calls to itself", () => {
    const body = `
async function main() {
  if (false) await main();
  return 1;
}
return main();
`;
    expect(buildAutoInvokeTrailer(body)).toBe("");
  });

  it("does not auto-invoke a const arrow that is already invoked", () => {
    const body = `
const main = async () => {
  return 1;
};
const r = await main();
`;
    expect(buildAutoInvokeTrailer(body)).toBe("");
  });

  it("does auto-invoke a const arrow declared but not called", () => {
    const body = `
const main = async () => {
  return 1;
};
`;
    const trailer = buildAutoInvokeTrailer(body);
    expect(trailer).toContain("await main()");
  });

  it("respects DATAFETCH_DISABLE_AUTO_INVOKE=1", () => {
    const body = `async function main() { return 1; }`;
    const prev = process.env["DATAFETCH_DISABLE_AUTO_INVOKE"];
    process.env["DATAFETCH_DISABLE_AUTO_INVOKE"] = "1";
    try {
      expect(buildAutoInvokeTrailer(body)).toBe("");
    } finally {
      if (prev === undefined) delete process.env["DATAFETCH_DISABLE_AUTO_INVOKE"];
      else process.env["DATAFETCH_DISABLE_AUTO_INVOKE"] = prev;
    }
  });

  it("does not auto-invoke when main is referenced only inside a string literal", () => {
    const body = `
const x = "main()";
`;
    expect(buildAutoInvokeTrailer(body)).toBe("");
  });

  it("does not get confused by a top-level invocation inside a block comment", () => {
    const body = `
async function main() { return 1; }
/* main(); */
`;
    const trailer = buildAutoInvokeTrailer(body);
    expect(trailer).toContain("await main()");
  });
});
