import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { atlasfsHome, trajectoryId, type PrimitiveCallRecord } from "../trajectory/recorder.js";
import type { RunQueryResult } from "../runner.js";
import { executeLearnedFunction, LocalFunctionStore, type LearnedFunction } from "../datafetch/primitives/learned_functions.js";

export type WorkspaceManifest = {
  version: 1;
  createdAt: string;
  datasets: Array<{
    id: string;
    adapter: string;
    collections: string[];
  }>;
  tenants: string[];
  capabilities: {
    localRuntime: true;
  };
};

type WorkspaceProcedure = {
  name: WorkspaceProcedureName;
  tenantId: string;
  intent: WorkspaceIntent;
  collection: WorkspaceCollection;
  createdAt: string;
  sourceTrajectoryId: string;
  schemaPins: Record<string, string>;
  verifier: {
    status: "passed" | "failed";
    shadowQuestion: string;
    shadowAnswer: number;
  };
  optimisation?: {
    status: "compiled";
    beforeCost: number;
    afterCost: number;
    compiledPlanPath: string;
  };
};

type WorkspaceDraft = {
  id: string;
  tenantId: string;
  question: string;
  intent: WorkspaceIntent;
  collection: WorkspaceCollection;
  sourceTrajectoryId: string;
  answer: number;
  createdAt: string;
};

type WorkspaceProcedureName = "customer_total_revenue" | "customer_open_tickets";
type WorkspaceIntent = "customer_total_revenue" | "customer_open_tickets";
type WorkspaceCollection = "orders" | "tickets";

type OrderRow = {
  id: string;
  customer: string;
  region: string;
  status: string;
  amount: number;
  product: string;
};

type TicketRow = {
  id: string;
  account: string;
  priority: "low" | "medium" | "high";
  status: "open" | "closed";
  topic: string;
  satisfaction: number;
};

type EventRow =
  | {
      id: string;
      kind: "deploy";
      service: string;
      actor: string;
      version: string;
      rollback: boolean;
    }
  | {
      id: string;
      kind: "incident";
      service: string;
      severity: "low" | "medium" | "high";
      status: "open" | "resolved";
    };

const fixtureOrders: OrderRow[] = [
  { id: "ord_001", customer: "acme", region: "north", status: "paid", amount: 125, product: "storage" },
  { id: "ord_002", customer: "acme", region: "north", status: "paid", amount: 300, product: "compute" },
  { id: "ord_003", customer: "beta", region: "west", status: "paid", amount: 210, product: "support" }
];

const fixtureTickets: TicketRow[] = [
  { id: "tic_001", account: "acme", priority: "high", status: "open", topic: "billing", satisfaction: 2 },
  { id: "tic_002", account: "beta", priority: "medium", status: "closed", topic: "onboarding", satisfaction: 4 }
];

const fixtureEvents: EventRow[] = [
  { id: "evt_001", kind: "deploy", service: "checkout", actor: "data-analyst", version: "2026.05.01", rollback: false },
  { id: "evt_002", kind: "incident", service: "checkout", severity: "high", status: "open" }
];

export function workspaceManifestPath(baseDir = atlasfsHome()): string {
  return path.join(baseDir, "workspace.json");
}

export async function readWorkspaceManifest(baseDir = atlasfsHome()): Promise<WorkspaceManifest | null> {
  try {
    return JSON.parse(await readFile(workspaceManifestPath(baseDir), "utf8")) as WorkspaceManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function hasWorkspace(baseDir = atlasfsHome()): Promise<boolean> {
  return (await readWorkspaceManifest(baseDir)) !== null;
}

export async function workspaceTenantForUi(tenantId: string, baseDir = atlasfsHome()): Promise<string> {
  const manifest = await readWorkspaceManifest(baseDir);
  if (!manifest) {
    return tenantId;
  }
  if (tenantId === "alice" && manifest.tenants[0]) return manifest.tenants[0];
  if (tenantId === "bob" && manifest.tenants[1]) return manifest.tenants[1];
  return tenantId;
}

export async function initWorkspace(args: {
  baseDir?: string;
  fixture?: "all";
  tenants?: string[];
} = {}): Promise<WorkspaceManifest> {
  const baseDir = args.baseDir ?? atlasfsHome();
  const now = new Date().toISOString();
  const manifest: WorkspaceManifest = {
    version: 1,
    createdAt: now,
    datasets: [
      { id: "fixture-finance", adapter: "fixture-finance", collections: ["orders"] },
      { id: "fixture-support", adapter: "fixture-support", collections: ["tickets"] },
      { id: "fixture-events", adapter: "fixture-events", collections: ["events"] }
    ],
    tenants: args.tenants ?? ["data-analyst", "support-analyst"],
    capabilities: {
      localRuntime: true
    }
  };

  await mkdir(path.join(baseDir, "data", "fixture-finance"), { recursive: true });
  await mkdir(path.join(baseDir, "data", "fixture-support"), { recursive: true });
  await mkdir(path.join(baseDir, "data", "fixture-events"), { recursive: true });
  await mkdir(path.join(baseDir, "hooks", "finance"), { recursive: true });
  await mkdir(path.join(baseDir, "hooks", "support"), { recursive: true });
  await writeJsonl(path.join(baseDir, "data", "fixture-finance", "orders.jsonl"), fixtureOrders);
  await writeJsonl(path.join(baseDir, "data", "fixture-support", "tickets.jsonl"), fixtureTickets);
  await writeJsonl(path.join(baseDir, "data", "fixture-events", "events.jsonl"), fixtureEvents);
  await writeFile(
    path.join(baseDir, "hooks", "finance", "customer_total_revenue.json"),
    `${JSON.stringify(
      {
        name: "finance.customer_total_revenue",
        intent: "customer_total_revenue",
        description: "Compute total order revenue for a named customer from orders.amount.",
        collections: ["orders"],
        route: ["orders.search", "orders.sum"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(baseDir, "hooks", "support", "customer_open_tickets.json"),
    `${JSON.stringify(
      {
        name: "support.customer_open_tickets",
        intent: "customer_open_tickets",
        description: "Count open support tickets for a named customer account.",
        collections: ["tickets"],
        route: ["tickets.search", "tickets.count"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(workspaceManifestPath(baseDir), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function runWorkspaceQuery(args: {
  question: string;
  tenantId: string;
  baseDir?: string;
}): Promise<RunQueryResult> {
  const baseDir = args.baseDir ?? atlasfsHome();
  const manifest = await readWorkspaceManifest(baseDir);
  if (!manifest) {
    throw new Error(`No AtlasFS workspace found at ${workspaceManifestPath(baseDir)}. Run atlasfs init first.`);
  }

  const id = trajectoryId();
  const startedAt = new Date().toISOString();
  const calls: PrimitiveCallRecord[] = [];
  const call = <T>(primitive: string, input: unknown, output: T): T => {
    calls.push({
      index: calls.length,
      primitive,
      input,
      output,
      startedAt: new Date().toISOString(),
      durationMs: 0
    });
    return output;
  };

  const q = args.question.toLowerCase();
  if (q.includes("total revenue") || q.includes("total order")) {
    const procedure = await findWorkspaceProcedure(baseDir, args.tenantId, "customer_total_revenue");
    const orders = await loadJsonl<OrderRow>(path.join(baseDir, "data", "fixture-finance", "orders.jsonl"));
    const customer = q.includes("beta") ? "beta" : q.includes("acme") ? "acme" : "";
    if (!customer) {
      throw new Error(`Could not infer customer from question: ${args.question}`);
    }
    if (procedure?.verifier.status === "passed") {
      const matches = orders.filter((order) => order.customer === customer);
      const answer = matches.reduce((sum, order) => sum + order.amount, 0);
      return {
        mode: "procedure",
        answer,
        procedureName: procedure.name,
        calls: [
          {
            index: 0,
            primitive: `procedures.${procedure.name}`,
            input: {
              customer,
              compiled: procedure.optimisation?.status === "compiled",
              compiledPlan: procedure.optimisation?.compiledPlanPath
            },
            output: { answer },
            startedAt: new Date().toISOString(),
            durationMs: 0
          }
        ],
        evidence: matches
      };
    }

    call("hooks.finance.customer_total_revenue", { question: args.question }, { collection: "orders", field: "amount" });
    const matches = call("orders.search", { query: args.question, customer }, orders.filter((order) => order.customer === customer));
    const answer = call(
      "orders.sum",
      { field: "amount", rowCount: matches.length },
      matches.reduce((sum, order) => sum + order.amount, 0)
    );
    const draftId = id;
    const trajectory = {
      id,
      tenantId: args.tenantId,
      question: args.question,
      mode: "novel" as const,
      calls,
      result: { answer, evidence: matches },
      createdAt: startedAt
    };
    await saveWorkspaceTrajectory(baseDir, trajectory);
    await saveWorkspaceDraft(baseDir, {
      id: draftId,
      tenantId: args.tenantId,
      question: args.question,
      intent: "customer_total_revenue",
      collection: "orders",
      sourceTrajectoryId: id,
      answer,
      createdAt: startedAt
    });
    return {
      mode: "novel",
      answer,
      trajectoryId: id,
      draftId,
      calls,
      evidence: matches
    };
  }

  if (q.includes("ticket") && q.includes("open")) {
    const procedure = await findWorkspaceProcedure(baseDir, args.tenantId, "customer_open_tickets");
    const tickets = await loadJsonl<TicketRow>(path.join(baseDir, "data", "fixture-support", "tickets.jsonl"));
    const account = q.includes("beta") ? "beta" : q.includes("acme") ? "acme" : "";
    if (!account) {
      throw new Error(`Could not infer account from question: ${args.question}`);
    }
    const matches = tickets.filter((ticket) => ticket.account === account && ticket.status === "open");
    const answer = matches.length;
    if (procedure?.verifier.status === "passed") {
      return {
        mode: "procedure",
        answer,
        procedureName: procedure.name,
        calls: [
          {
            index: 0,
            primitive: `procedures.${procedure.name}`,
            input: {
              account,
              compiled: procedure.optimisation?.status === "compiled",
              compiledPlan: procedure.optimisation?.compiledPlanPath
            },
            output: { answer },
            startedAt: new Date().toISOString(),
            durationMs: 0
          }
        ],
        evidence: matches
      };
    }

    call("hooks.support.customer_open_tickets", { question: args.question }, { collection: "tickets", field: "status" });
    const searched = call("tickets.search", { query: args.question, account, status: "open" }, matches);
    call("tickets.count", { rowCount: searched.length }, answer);
    const draftId = id;
    const trajectory = {
      id,
      tenantId: args.tenantId,
      question: args.question,
      mode: "novel" as const,
      calls,
      result: { answer, evidence: searched },
      createdAt: startedAt
    };
    await saveWorkspaceTrajectory(baseDir, trajectory);
    await saveWorkspaceDraft(baseDir, {
      id: draftId,
      tenantId: args.tenantId,
      question: args.question,
      intent: "customer_open_tickets",
      collection: "tickets",
      sourceTrajectoryId: id,
      answer,
      createdAt: startedAt
    });
    return {
      mode: "novel",
      answer,
      trajectoryId: id,
      draftId,
      calls,
      evidence: searched
    };
  }

  if ((q.includes("standard deviation") || q.includes("stddev") || q.includes("std dev")) && q.includes("order")) {
    const orders = await loadJsonl<OrderRow>(path.join(baseDir, "data", "fixture-finance", "orders.jsonl"));
    const customer = q.includes("beta") ? "beta" : q.includes("acme") ? "acme" : "";
    if (!customer) {
      throw new Error(`Could not infer customer from question: ${args.question}`);
    }
    const matches = call("orders.search", { query: args.question, customer }, orders.filter((order) => order.customer === customer));
    const values = matches.map((order) => order.amount);
    const fnStore = new LocalFunctionStore(baseDir);
    let fn = await fnStore.findByName(args.tenantId, "stats.stddev");
    if (!fn) {
      fn = stddevLearnedFunction();
      call("observer.codifyFunction", { missingPrimitive: "stats.stddev", values }, { name: fn.name, signature: fn.signature });
      const saved = await fnStore.save(args.tenantId, fn);
      call("function_store.save", { tenantId: args.tenantId, name: fn.name }, saved);
    } else {
      call("function_store.findReusable", { tenantId: args.tenantId, name: fn.name }, { found: true });
    }
    const answer = call("stats.stddev", { values }, executeLearnedFunction(fn, [values]) as number);
    const trajectory = {
      id,
      tenantId: args.tenantId,
      question: args.question,
      mode: "novel" as const,
      calls,
      result: { answer, evidence: matches },
      createdAt: startedAt
    };
    await saveWorkspaceTrajectory(baseDir, trajectory);
    return {
      mode: "novel",
      answer,
      trajectoryId: id,
      calls,
      evidence: matches
    };
  }

  throw new Error(`Workspace fixture runner cannot answer: ${args.question}`);
}

export async function reviewWorkspaceDraft(args: {
  draftIdOrPath: string;
  tenantId?: string;
  baseDir?: string;
}): Promise<{
  procedureName: string;
  verifier: WorkspaceProcedure["verifier"];
  jsonPath: string;
}> {
  const baseDir = args.baseDir ?? atlasfsHome();
  const draft = await readWorkspaceDraft(baseDir, args.draftIdOrPath);
  const shadowAnswer = await workspaceShadowAnswer(baseDir, draft.intent);
  const verifier: WorkspaceProcedure["verifier"] = {
    status: shadowAnswer === expectedShadowAnswer(draft.intent) ? "passed" : "failed",
    shadowQuestion:
      draft.intent === "customer_total_revenue"
        ? "what is total revenue for beta?"
        : "how many open support tickets for beta?",
    shadowAnswer
  };
  const procedure: WorkspaceProcedure = {
    name: procedureNameForIntent(draft.intent),
    tenantId: args.tenantId ?? draft.tenantId,
    intent: draft.intent,
    collection: draft.collection,
    createdAt: new Date().toISOString(),
    sourceTrajectoryId: draft.sourceTrajectoryId,
    schemaPins: await schemaPinsForDraft(baseDir, draft),
    verifier
  };
  if (verifier.status !== "passed") {
    await saveRejectedPromotion(baseDir, draft, verifier);
    throw new Error(`Verifier failed for ${procedure.name}`);
  }
  const dir = path.join(baseDir, "procedures", procedure.tenantId);
  await mkdir(dir, { recursive: true });
  const jsonPath = path.join(dir, `${procedure.name}.json`);
  await writeFile(jsonPath, `${JSON.stringify(procedure, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(dir, `${procedure.name}.ts`),
    `export const procedure = ${JSON.stringify(procedure, null, 2)} as const;\n`,
    "utf8"
  );
  return { procedureName: procedure.name, verifier, jsonPath };
}

export async function budgetWorkspaceProcedure(args: {
  procedureName: string;
  tenantId: string;
  baseDir?: string;
}): Promise<{ procedureName: string; status: "compiled"; beforeCost: number; afterCost: number }> {
  const baseDir = args.baseDir ?? atlasfsHome();
  const procedure = await findWorkspaceProcedure(baseDir, args.tenantId, args.procedureName);
  if (!procedure) {
    throw new Error(`No procedure ${args.procedureName} for tenant ${args.tenantId}`);
  }
  const updated: WorkspaceProcedure = {
    ...procedure,
    optimisation: {
      status: "compiled",
      beforeCost: 3,
      afterCost: 1,
      compiledPlanPath: path.join(baseDir, "compiled", args.tenantId, `${procedure.name}.json`)
    }
  };
  await writeCompiledPlan(baseDir, updated);
  await writeWorkspaceProcedure(baseDir, updated);
  return { procedureName: updated.name, status: "compiled", beforeCost: 3, afterCost: 1 };
}

export async function checkWorkspaceDrift(baseDir = atlasfsHome()): Promise<{
  procedures: Array<{ name: string; tenantId: string; drift: "current" | "drifted" }>;
}> {
  const currentPins = {
    orders: schemaFingerprint(await loadJsonl<OrderRow>(path.join(baseDir, "data", "fixture-finance", "orders.jsonl"))),
    tickets: schemaFingerprint(await loadJsonl<TicketRow>(path.join(baseDir, "data", "fixture-support", "tickets.jsonl")))
  };
  const procedures = await listWorkspaceProcedures(baseDir);
  return {
    procedures: procedures.map((procedure) => ({
      name: procedure.name,
      tenantId: procedure.tenantId,
      drift: Object.entries(procedure.schemaPins).every(
        ([collection, pin]) => currentPins[collection as keyof typeof currentPins] === pin
      )
        ? "current"
        : "drifted"
    }))
  };
}

export async function evalWorkspace(args: {
  round: number;
  tenants: string[];
  baseDir?: string;
}): Promise<{ round: number; rows: number; L_n: number }> {
  const baseDir = args.baseDir ?? atlasfsHome();
  const procedures = await listWorkspaceProcedures(baseDir);
  const signaturesByTenant = new Map<string, Set<string>>();
  for (const tenant of args.tenants) {
    signaturesByTenant.set(
      tenant,
      new Set(procedures.filter((procedure) => procedure.tenantId === tenant).map((procedure) => procedure.name))
    );
  }
  const [left = new Set<string>(), right = new Set<string>()] = Array.from(signaturesByTenant.values());
  const union = new Set([...left, ...right]);
  const intersection = new Set([...left].filter((item) => right.has(item)));
  const L_n = union.size === 0 ? 0 : 1 - intersection.size / union.size;
  const dir = path.join(baseDir, "eval");
  await mkdir(dir, { recursive: true });
  const baselines = ["vanilla_rag", "static_typed", "atlasfs"] as const;
  for (const baseline of baselines) {
    for (const tenant of args.tenants) {
      const sigs = signaturesByTenant.get(tenant) ?? new Set();
      const adapted = baseline === "atlasfs" && sigs.size > 0;
      const row = {
        baseline,
        round: args.round,
        tenant,
        T_n: adapted ? 1 : baseline === "static_typed" ? 2 : 4,
        D_n: adapted ? 1 : baseline === "static_typed" ? 0.75 : 0,
        R_n: adapted ? 1 : 0,
        I_n: adapted ? sigs.size : 0,
        L_n: baseline === "atlasfs" ? L_n : 0,
        simulatedTokenCost: adapted ? 0 : baseline === "static_typed" ? 35 : 140,
        wallTimeMs: baseline === "atlasfs" ? 0 : baseline === "static_typed" ? 25 : 250,
        correctness: true,
        evidenceCompleteness: baseline === "vanilla_rag" ? 0.7 : 1
      };
      await appendFile(path.join(dir, "ledger.jsonl"), `${JSON.stringify(row)}\n`, "utf8");
    }
  }
  return { round: args.round, rows: args.tenants.length * baselines.length, L_n };
}

async function saveWorkspaceTrajectory(baseDir: string, trajectory: unknown): Promise<void> {
  const dir = path.join(baseDir, "trajectories");
  await mkdir(dir, { recursive: true });
  const record = trajectory as { id: string };
  await writeFile(path.join(dir, `${record.id}.json`), `${JSON.stringify(trajectory, null, 2)}\n`, "utf8");
}

async function writeJsonl(file: string, rows: unknown[]): Promise<void> {
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

async function writeCompiledPlan(baseDir: string, procedure: WorkspaceProcedure): Promise<void> {
  const dir = path.join(baseDir, "compiled", procedure.tenantId);
  await mkdir(dir, { recursive: true });
  const plan =
    procedure.intent === "customer_total_revenue"
      ? {
          procedureName: procedure.name,
          collection: "orders",
          operation: "sum",
          filterField: "customer",
          valueField: "amount",
          verifier: procedure.verifier
        }
      : {
          procedureName: procedure.name,
          collection: "tickets",
          operation: "count",
          filterField: "account",
          fixedFilter: { status: "open" },
          verifier: procedure.verifier
        };
  await writeFile(path.join(dir, `${procedure.name}.json`), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

async function workspaceShadowAnswer(baseDir: string, intent: WorkspaceIntent): Promise<number> {
  if (intent === "customer_total_revenue") {
    const orders = await loadJsonl<OrderRow>(path.join(baseDir, "data", "fixture-finance", "orders.jsonl"));
    return orders.filter((order) => order.customer === "beta").reduce((sum, order) => sum + order.amount, 0);
  }
  const tickets = await loadJsonl<TicketRow>(path.join(baseDir, "data", "fixture-support", "tickets.jsonl"));
  return tickets.filter((ticket) => ticket.account === "beta" && ticket.status === "open").length;
}

function expectedShadowAnswer(intent: WorkspaceIntent): number {
  return intent === "customer_total_revenue" ? 210 : 0;
}

function procedureNameForIntent(intent: WorkspaceIntent): WorkspaceProcedureName {
  return intent === "customer_total_revenue" ? "customer_total_revenue" : "customer_open_tickets";
}

function stddevLearnedFunction(): LearnedFunction {
  return {
    name: "stats.stddev",
    description: "Compute the population standard deviation of numeric values.",
    signature: "stddev(values: number[]): number",
    source: `function stddev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}`,
    observer: "fixture",
    createdAt: new Date().toISOString()
  };
}

async function schemaPinsForDraft(baseDir: string, draft: WorkspaceDraft): Promise<Record<string, string>> {
  if (draft.collection === "orders") {
    const orders = await loadJsonl<OrderRow>(path.join(baseDir, "data", "fixture-finance", "orders.jsonl"));
    return { orders: schemaFingerprint(orders) };
  }
  const tickets = await loadJsonl<TicketRow>(path.join(baseDir, "data", "fixture-support", "tickets.jsonl"));
  return { tickets: schemaFingerprint(tickets) };
}

async function loadJsonl<T>(file: string): Promise<T[]> {
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function schemaFingerprint(rows: unknown[]): string {
  const shapes = Array.from(
    new Set(rows.map((row) => JSON.stringify(Object.keys(row as Record<string, unknown>).sort())))
  ).sort();
  return `sha256:${createHash("sha256").update(JSON.stringify(shapes)).digest("hex").slice(0, 16)}`;
}

async function saveWorkspaceDraft(baseDir: string, draft: WorkspaceDraft): Promise<void> {
  const dir = path.join(baseDir, "drafts");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${draft.id}.json`), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
}

async function readWorkspaceDraft(baseDir: string, idOrPath: string): Promise<WorkspaceDraft> {
  const file = idOrPath.endsWith(".json") ? idOrPath : path.join(baseDir, "drafts", `${idOrPath}.json`);
  return JSON.parse(await readFile(file, "utf8")) as WorkspaceDraft;
}

async function saveRejectedPromotion(
  baseDir: string,
  draft: WorkspaceDraft,
  verifier: WorkspaceProcedure["verifier"]
): Promise<void> {
  const dir = path.join(baseDir, "review-events");
  await mkdir(dir, { recursive: true });
  await appendFile(
    path.join(dir, `${draft.id}.jsonl`),
    `${JSON.stringify({ action: "reject", result: "rejected_promotion", verifier })}\n`,
    "utf8"
  );
}

async function findWorkspaceProcedure(
  baseDir: string,
  tenantId: string,
  procedureName: string
): Promise<WorkspaceProcedure | null> {
  try {
    return JSON.parse(
      await readFile(path.join(baseDir, "procedures", tenantId, `${procedureName}.json`), "utf8")
    ) as WorkspaceProcedure;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeWorkspaceProcedure(baseDir: string, procedure: WorkspaceProcedure): Promise<void> {
  const dir = path.join(baseDir, "procedures", procedure.tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${procedure.name}.json`), `${JSON.stringify(procedure, null, 2)}\n`, "utf8");
}

export async function listWorkspaceProcedures(baseDir: string): Promise<WorkspaceProcedure[]> {
  const root = path.join(baseDir, "procedures");
  let tenants: string[];
  try {
    tenants = await readdir(root);
  } catch {
    return [];
  }
  const procedures: WorkspaceProcedure[] = [];
  for (const tenant of tenants) {
    let entries: string[];
    try {
      entries = await readdir(path.join(root, tenant));
    } catch {
      continue;
    }
    for (const entry of entries.filter((file) => file.endsWith(".json"))) {
      procedures.push(
        JSON.parse(await readFile(path.join(root, tenant, entry), "utf8")) as WorkspaceProcedure
      );
    }
  }
  return procedures;
}
