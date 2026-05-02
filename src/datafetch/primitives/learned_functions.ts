import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { atlasfsHome } from "../../trajectory/recorder.js";

/**
 * A deterministic TypeScript function the observer codified at runtime in
 * response to an off-script question. Saved per-tenant under
 * `<atlasfsHome>/functions/<tenantId>/<name>.{json,ts}`.
 *
 * The .json is load-bearing (the runtime evaluates `source` via `new Function`,
 * mirroring `executeCodifiedFunction` in finqa_observe.ts); the .ts is a
 * cosmetic mirror so a human or the CodeViewer can read it.
 */
export type LearnedFunction = {
  name: string; // e.g. "stats.stddev"
  description: string;
  signature: string; // human-readable, e.g. "stddev(values: number[]): number"
  source: string; // function body string, eval'd via `new Function`
  observer: "fixture" | "anthropic" | "flue";
  createdAt: string;
};

function fileSafe(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class LocalFunctionStore {
  constructor(private readonly baseDir = atlasfsHome()) {}

  private tenantDir(tenantId: string): string {
    return path.join(this.baseDir, "functions", tenantId);
  }

  async save(tenantId: string, fn: LearnedFunction): Promise<{ jsonPath: string; tsPath: string }> {
    const dir = this.tenantDir(tenantId);
    await mkdir(dir, { recursive: true });
    const safe = fileSafe(fn.name);
    const jsonPath = path.join(dir, `${safe}.json`);
    const tsPath = path.join(dir, `${safe}.ts`);
    await writeFile(jsonPath, `${JSON.stringify(fn, null, 2)}\n`, "utf8");
    await writeFile(tsPath, renderTs(fn), "utf8");
    return { jsonPath, tsPath };
  }

  async list(tenantId: string): Promise<LearnedFunction[]> {
    const dir = this.tenantDir(tenantId);
    try {
      const entries = await readdir(dir);
      return Promise.all(
        entries
          .filter((entry) => entry.endsWith(".json"))
          .map(async (entry) =>
            JSON.parse(await readFile(path.join(dir, entry), "utf8")) as LearnedFunction
          )
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async findByName(tenantId: string, name: string): Promise<LearnedFunction | null> {
    const all = await this.list(tenantId);
    return all.find((fn) => fn.name === name) ?? null;
  }
}

function renderTs(fn: LearnedFunction): string {
  return `// learned function · ${fn.name}
// observer: ${fn.observer}
// created: ${fn.createdAt}
//
// ${fn.description}

// signature: ${fn.signature}

${fn.source}
`;
}

/**
 * Evaluate a learned function's `source` and apply it to the given args.
 * Mirrors `executeCodifiedFunction` in finqa_observe.ts — the source is
 * expected to declare a single named function that takes args by position.
 *
 * Naming convention: the function name in `source` matches the suffix of
 * `name` after the last `.`. So "stats.stddev" -> `function stddev(...)`.
 */
export function executeLearnedFunction(fn: LearnedFunction, args: unknown[]): unknown {
  const memberName = fn.name.includes(".") ? fn.name.split(".").pop()! : fn.name;
  // Wrap the source so we can reach the declared function and call it
  // by position. `source` must contain a function declaration with `memberName`.
  const wrapper = `${fn.source}\nreturn ${memberName}.apply(null, __args);`;
  // eslint-disable-next-line no-new-func
  const factory = new Function("__args", wrapper) as (a: unknown[]) => unknown;
  return factory(args);
}
