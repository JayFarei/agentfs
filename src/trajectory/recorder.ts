import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PrimitiveCallRecord = {
  index: number;
  primitive: string;
  input: unknown;
  output: unknown;
  startedAt: string;
  durationMs: number;
};

export type TrajectoryRecord = {
  id: string;
  tenantId: string;
  question: string;
  mode: "novel";
  calls: PrimitiveCallRecord[];
  result?: unknown;
  createdAt: string;
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
      mode: "novel",
      calls: [],
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
    const started = Date.now();
    const output = await fn(input);
    this.record.calls.push({
      index: this.record.calls.length,
      primitive,
      input,
      output,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started
    });
    return output;
  }

  setResult(result: unknown): void {
    this.record.result = result;
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
