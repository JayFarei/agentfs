import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import type { Cost, ResultMode } from "../sdk/result.js";

export type PrimitiveCallRecord = {
  index: number;
  primitive: string;
  input: unknown;
  output: unknown;
  startedAt: string;
  durationMs: number;
  // Optional content-addressable pin for the artefact this call resolved
  // against. Populated by the snippet runtime once content-addressing lands;
  // safe to leave unset in earlier phases.
  pin?: string;
};

// Per-trajectory provenance block. Intentionally a subset of the SDK
// `Provenance` type — the trajectory file lives next to the data and
// references the originating tenant + mount + (optional) function.
export type TrajectoryProvenance = {
  tenant: string;
  mount: string;
  functionName?: string;
};

export type TrajectoryPhase = "plan" | "execute" | "run" | "commit";

export type TrajectoryRecord = {
  id: string;
  tenantId: string;
  question: string;
  // Widened from the prototype's `"novel"`-only literal to the full
  // ResultMode union so trajectories can record interpreted / llm-backed
  // / cache hits as well. Per PRD §8.1: `novel` means "first-time
  // successful ad-hoc composition" (tier 4), NOT "errored". Errors are
  // signalled via the separate `errored` flag below.
  mode: ResultMode;
  calls: PrimitiveCallRecord[];
  result?: unknown;
  createdAt: string;
  // True when the snippet threw or no body executed. Disjoint from `mode`
  // so the observer can gate crystallisation on errors without conflating
  // them with the novel/interpreted distinction.
  errored?: boolean;
  // The fields below are optional in the envelope. They are populated
  // by the snippet runtime once a snippet completes; the legacy code
  // path leaves them undefined.
  cost?: Cost;
  provenance?: TrajectoryProvenance;
  phase?: TrajectoryPhase;
  crystallisable?: boolean;
  sourcePath?: string;
  artifactDir?: string;
  answer?: unknown;
  answerValidation?: unknown;
};

export function atlasfsHome(): string {
  return process.env.ATLASFS_HOME ?? path.join(process.cwd(), ".atlasfs");
}

export function trajectoryId(now = new Date()): string {
  return `traj_${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class TrajectoryRecorder {
  private readonly record: TrajectoryRecord;

  constructor(args: { tenantId: string; question: string; id?: string }) {
    this.record = {
      id: args.id ?? trajectoryId(),
      tenantId: args.tenantId,
      question: args.question,
      // Default to "interpreted" — the snippet runtime sets the final
      // mode (novel/interpreted/llm-backed) once the snippet completes.
      // Error paths are signalled via `errored: true`, not via mode.
      mode: "interpreted",
      calls: [],
      errored: false,
      createdAt: new Date().toISOString()
    };
  }

  get id(): string {
    return this.record.id;
  }

  get snapshot(): TrajectoryRecord {
    return structuredClone(this.record);
  }

  async call<TInput, TOutput>(
    primitive: string,
    input: TInput,
    fn: (input: TInput) => Promise<TOutput> | TOutput
  ): Promise<TOutput> {
    const startedWall = Date.now();
    const startedHr = performance.now();
    const output = await fn(input);
    this.record.calls.push({
      index: this.record.calls.length,
      primitive,
      input,
      output,
      startedAt: new Date(startedWall).toISOString(),
      // Sub-millisecond resolution; the cost panel relies on fractional
      // ms to make the pure-TS hot path visible vs cold-path roundtrips.
      durationMs: performance.now() - startedHr
    });
    return output;
  }

  setResult(result: unknown): void {
    this.record.result = result;
  }

  setAnswer(answer: unknown): void {
    this.record.answer = answer;
  }

  setAnswerValidation(validation: unknown): void {
    this.record.answerValidation = validation;
  }

  setMode(mode: ResultMode): void {
    this.record.mode = mode;
  }

  setErrored(errored: boolean): void {
    this.record.errored = errored;
  }

  setCost(cost: Cost): void {
    this.record.cost = cost;
  }

  setProvenance(provenance: TrajectoryProvenance): void {
    this.record.provenance = provenance;
  }

  setExecutionMetadata(metadata: {
    phase?: TrajectoryPhase;
    crystallisable?: boolean;
    sourcePath?: string;
    artifactDir?: string;
  }): void {
    if (metadata.phase !== undefined) this.record.phase = metadata.phase;
    if (metadata.crystallisable !== undefined) {
      this.record.crystallisable = metadata.crystallisable;
    }
    if (metadata.sourcePath !== undefined) {
      this.record.sourcePath = metadata.sourcePath;
    }
    if (metadata.artifactDir !== undefined) {
      this.record.artifactDir = metadata.artifactDir;
    }
  }

  async save(baseDir = atlasfsHome()): Promise<string> {
    const dir = path.join(baseDir, "trajectories");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${this.record.id}.json`);
    await writeFile(file, `${JSON.stringify(this.record, null, 2)}\n`, "utf8");
    return file;
  }
}

export async function readTrajectory(idOrPath: string, baseDir = atlasfsHome()): Promise<TrajectoryRecord> {
  const file = idOrPath.endsWith(".json")
    ? idOrPath
    : path.join(baseDir, "trajectories", `${idOrPath}.json`);
  return JSON.parse(await readFile(file, "utf8")) as TrajectoryRecord;
}
