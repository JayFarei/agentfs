import { promises as fsp } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { getMountRuntimeRegistry, type MountRuntime } from "../adapter/runtime.js";
import { installObserver, type InstallObserverResult } from "../observer/install.js";
import { searchLibrary } from "../discovery/librarySearch.js";
import { installSnippetRuntime, type InstallSnippetRuntimeResult } from "../snippet/install.js";
import { summarizeCallScopes } from "../trajectory/callScope.js";
import type { SnippetRunResult } from "../bash/snippetRuntime.js";
import {
  readTrajectory,
  type CollectionHandle,
  type MountAdapter,
  type MountInventory,
  type SampleOpts,
  type SourceCapabilities,
  type TrajectoryRecord,
} from "../sdk/index.js";

const DEFAULT_CODEX_MODEL = "gpt-5.4-mini";
const DEFAULT_REASONING_EFFORT = "low";

type Round = "cold" | "warm" | "hard";
type Mode = "baseline" | "datafetch";
type AnswerStatus = "answered" | "partial" | "unsupported";
type EvalDriver = "deterministic-local-e2e" | "codex-live";

interface EvalRecord {
  id: string;
  family: string;
  entity: string;
  label: string;
  region?: string;
  year?: number;
  metrics: Record<string, number>;
  attributes: Record<string, string | number | boolean>;
}

interface FamilySpec {
  id: string;
  title: string;
  skillcraftFamily: string;
  seedFunction: string;
  records: EvalRecord[];
  tasks: TaskSpec[];
}

interface TaskSpec {
  taskFamily: string;
  taskId: string;
  round: Round;
  intent: string;
  entities: string[];
  analysis: "summary" | "hard";
  expectedValue: unknown;
  goldEvidence: string[];
}

interface EpisodeMetrics {
  taskFamily: string;
  taskId: string;
  round: Round;
  mode: Mode;
  answerStatus: AnswerStatus;
  answerCorrect: boolean;
  evidenceRecall: number;
  evidencePrecision: number;
  derivationPresent: boolean;
  derivationStepsCount: number;
  libFunctionsAvailable: number;
  libFunctionsUsed: number;
  libFunctionsCreated: number;
  reuseRate: number;
  totalTokens: number;
  effectiveTokens: number;
  llmCalls: number;
  toolCalls: number;
  elapsedMs: number;
  abstainedCorrectly: boolean;
  regressionsPassed: boolean;
  substrateDbCalls: number;
  clientLibCalls: number;
  runtimeElapsedMs: number;
  artifactPath?: string;
  learnedFunction?: string;
  agentDriver?: string;
  agentElapsedMs?: number;
  agentInputTokens?: number;
  agentCachedInputTokens?: number;
  agentUncachedInputTokens?: number;
  agentOutputTokens?: number;
  agentReasoningTokens?: number;
  agentExitCode?: number;
  agentCommandsRun?: number;
  agentWorkspaceFilesRead?: number;
  agentWorkspaceBytesRead?: number;
  agentDiscoveryCalls?: number;
  agentSelectedInterface?: string;
  agentWroteDbCall?: boolean;
  agentReadSampleData?: boolean;
}

interface EpisodeResult {
  metrics: EpisodeMetrics;
  answer: unknown;
  source: string;
  trajectory?: TrajectoryRecord;
}

interface SkillcraftEvalReport {
  generatedAt: string;
  sourceMethodology: {
    paper: string;
    repo: string;
    selectedFamilies: string[];
  };
  artifactDir: string;
  episodes: EpisodeMetrics[];
  comparison: {
    baseline: AggregateMetrics;
    datafetchCold: AggregateMetrics;
    datafetchWarm: AggregateMetrics;
    datafetchHard: AggregateMetrics;
    warmVsBaseline: DeltaMetrics;
  };
  perFamily: FamilyBreakdown[];
  diagnostics: string[];
	  execution: {
	    driver: EvalDriver;
	    tasks: number;
	    episodes: number;
	    replayChecks: number;
	    warmFastPath: boolean;
	  };
	}

interface AggregateMetrics {
  count: number;
  correctness: number;
  evidenceRecall: number;
  avgTokens: number;
  avgEffectiveTokens: number;
  avgCachedInputTokens: number;
  avgUncachedInputTokens: number;
  avgOutputTokens: number;
  avgLatencyMs: number;
  avgToolCalls: number;
  avgCommandsRun: number;
  avgWorkspaceBytesRead: number;
  reuseRate: number | null;
  regressions: number | null;
}

interface DeltaMetrics {
  correctness: number;
  evidenceRecall: number;
  avgTokens: number;
  avgEffectiveTokens: number;
  avgLatencyMs: number;
  avgToolCalls: number;
  avgCommandsRun: number;
  avgWorkspaceBytesRead: number;
}

interface FamilyBreakdown {
  family: string;
  skillcraftFamily: string;
  learnedFunction?: string;
  cold: EpisodeMetrics;
  warm: EpisodeMetrics;
  hard: EpisodeMetrics;
}

interface RunOptions {
  artifactDir?: string;
  tempRoot?: string;
  families?: string[];
  driver?: EvalDriver;
  liveModel?: string;
  liveReasoningEffort?: string;
  liveTimeoutMs?: number;
  warmFastPath?: boolean;
}

type EvalHarness = InstallSnippetRuntimeResult & {
  mountId: string;
  observer?: InstallObserverResult;
};

interface AgentRun {
  driver: "codex";
  workspaceDir: string;
  prompt: string;
  stdout: string;
  stderr: string;
  finalMessage: string;
  elapsedMs: number;
  exitCode: number;
  usage: AgentUsage;
}

interface AgentUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  llmCalls: number;
}

interface LibraryDoc {
  name: string;
  kind: "seed" | "learned";
  description: string;
  invocation: string;
  inputType: string;
}

type LearnedInputKind = "queryOpts" | "filterLimit";

interface AgentBehavior {
  commandsRun: number;
  workspaceFilesRead: number;
  workspaceBytesRead: number;
  discoveryCalls: number;
  readSampleData: boolean;
}

class EvalCollectionHandle implements CollectionHandle<EvalRecord> {
  constructor(
    readonly mountId: string,
    readonly resourceId: string,
    private readonly records: EvalRecord[],
  ) {}

  async search(query: string, opts?: { limit?: number }): Promise<EvalRecord[]> {
    const tokens = tokenize(query);
    const ranked = this.records
      .map((record) => {
        const haystack = [
          record.id,
          record.family,
          record.entity,
          record.label,
          record.region ?? "",
          ...Object.entries(record.metrics).map(([key, value]) => `${key} ${value}`),
          ...Object.entries(record.attributes).map(([key, value]) => `${key} ${String(value)}`),
        ]
          .join(" ")
          .toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (haystack.includes(token)) score += 1;
        }
        if (record.family && query.includes(record.family)) score += 4;
        if (query.includes(record.entity)) score += 3;
        if (query.includes(record.label.toLowerCase())) score += 3;
        return { record, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id))
      .map((entry) => entry.record);
    return ranked.slice(0, opts?.limit ?? 25);
  }

  async findExact(filter: Partial<EvalRecord>, limit?: number): Promise<EvalRecord[]> {
    const matched = this.records.filter((record) =>
      Object.entries(filter).every(([field, value]) => {
        const topLevel = record as unknown as Record<string, unknown>;
        if (topLevel[field] === value) return true;
        if (record.metrics[field] === value) return true;
        return record.attributes[field] === value;
      }),
    );
    return limit !== undefined ? matched.slice(0, limit) : matched;
  }

  async findByField(field: string, value: string | number | boolean): Promise<EvalRecord[]> {
    return this.records.filter((record) => {
      const topLevel = record as unknown as Record<string, unknown>;
      if (topLevel[field] === value) return true;
      if (record.metrics[field] === value) return true;
      return record.attributes[field] === value;
    });
  }

  async findSimilar(query: string, limit?: number): Promise<EvalRecord[]> {
    return this.search(query, limit === undefined ? undefined : { limit });
  }

  async hybrid(query: string, opts?: { limit?: number }): Promise<EvalRecord[]> {
    return this.search(query, opts);
  }
}

class EvalMountAdapter implements MountAdapter {
  readonly id: string;

  constructor(id: string, private readonly records: EvalRecord[]) {
    this.id = id;
  }

  capabilities(): SourceCapabilities {
    return { vector: false, lex: true, stream: false, compile: false };
  }

  async probe(): Promise<MountInventory> {
    return { collections: [{ name: "records", rows: this.records.length }] };
  }

  async sample(_collection: string, opts: SampleOpts): Promise<unknown[]> {
    return this.records.slice(0, opts.size);
  }

  collection<T>(name: string): CollectionHandle<T> {
    if (name !== "records") {
      throw new Error(`EvalMountAdapter: unknown collection ${name}`);
    }
    return new EvalCollectionHandle(this.id, name, this.records) as unknown as CollectionHandle<T>;
  }

  async close(): Promise<void> {
    // no-op; in-memory evaluation dataset
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1);
}

function allFamilies(): FamilySpec[] {
  const economicRecords: EvalRecord[] = [
    rec("economic", "US", "United States", "Americas", { gdp: 27000, gdpPerCapita: 81000, population: 335, growth: 2.4 }),
    rec("economic", "CHN", "China", "Asia", { gdp: 17800, gdpPerCapita: 12600, population: 1410, growth: 5.2 }),
    rec("economic", "JPN", "Japan", "Asia", { gdp: 4200, gdpPerCapita: 34000, population: 124, growth: 1.1 }),
    rec("economic", "DEU", "Germany", "Europe", { gdp: 4500, gdpPerCapita: 54000, population: 84, growth: 0.3 }),
    rec("economic", "IND", "India", "Asia", { gdp: 3900, gdpPerCapita: 2800, population: 1420, growth: 7.1 }),
    rec("economic", "BRA", "Brazil", "Americas", { gdp: 2100, gdpPerCapita: 10000, population: 216, growth: 2.9 }),
  ];
  const blogRecords: EvalRecord[] = [
    rec("blog", "u1", "Ava Chen", "editorial", { posts: 14, comments: 96, likes: 840 }, { role: "author" }),
    rec("blog", "u2", "Noah Patel", "product", { posts: 9, comments: 140, likes: 720 }, { role: "author" }),
    rec("blog", "u3", "Mia Rossi", "support", { posts: 18, comments: 88, likes: 650 }, { role: "author" }),
    rec("blog", "u4", "Liam Stone", "editorial", { posts: 6, comments: 60, likes: 410 }, { role: "author" }),
    rec("blog", "u5", "Zoe Brooks", "product", { posts: 12, comments: 92, likes: 930 }, { role: "author" }),
    rec("blog", "u6", "Kai Morgan", "support", { posts: 8, comments: 44, likes: 380 }, { role: "author" }),
  ];
  const countryRecords: EvalRecord[] = [
    rec("country", "CAN", "Canada", "North America", { population: 39, borders: 1, area: 9985 }, { landlocked: false }),
    rec("country", "MEX", "Mexico", "North America", { population: 128, borders: 3, area: 1964 }, { landlocked: false }),
    rec("country", "USA", "United States", "North America", { population: 335, borders: 2, area: 9834 }, { landlocked: false }),
    rec("country", "FRA", "France", "Europe", { population: 68, borders: 8, area: 644 }, { landlocked: false }),
    rec("country", "CHE", "Switzerland", "Europe", { population: 9, borders: 5, area: 41 }, { landlocked: true }),
    rec("country", "AUT", "Austria", "Europe", { population: 9, borders: 8, area: 84 }, { landlocked: true }),
  ];
  const profileRecords: EvalRecord[] = [
    rec("profile", "US-F-34", "Maya Lewis", "US", { age: 34, purchases: 11, score: 82 }, { gender: "female" }),
    rec("profile", "US-M-41", "Ethan Park", "US", { age: 41, purchases: 6, score: 70 }, { gender: "male" }),
    rec("profile", "CA-F-29", "Sofia Grant", "CA", { age: 29, purchases: 15, score: 90 }, { gender: "female" }),
    rec("profile", "FR-F-38", "Camille Moreau", "FR", { age: 38, purchases: 5, score: 76 }, { gender: "female" }),
    rec("profile", "FR-M-52", "Luc Bernard", "FR", { age: 52, purchases: 8, score: 68 }, { gender: "male" }),
    rec("profile", "DE-F-31", "Anna Weiss", "DE", { age: 31, purchases: 10, score: 84 }, { gender: "female" }),
  ];
  const universityRecords: EvalRecord[] = [
    rec("university", "US-1", "Northlake Institute", "US", { rank: 24, students: 21000, founded: 1890 }, { type: "public" }),
    rec("university", "US-2", "Redwood College", "US", { rank: 55, students: 8700, founded: 1921 }, { type: "private" }),
    rec("university", "UK-1", "River Trent University", "UK", { rank: 31, students: 18000, founded: 1874 }, { type: "public" }),
    rec("university", "DE-1", "Hansa Technical University", "DE", { rank: 18, students: 26000, founded: 1868 }, { type: "public" }),
    rec("university", "DE-2", "Rhine Applied Sciences", "DE", { rank: 72, students: 14000, founded: 1972 }, { type: "public" }),
    rec("university", "FR-1", "Sorbonne Nouvelle Data School", "FR", { rank: 44, students: 12000, founded: 1903 }, { type: "public" }),
  ];
  const weatherRecords: EvalRecord[] = [
    rec("weather", "SEA", "Seattle", "US", { rain: 7.2, wind: 18, temp: 12 }, { condition: "wet" }),
    rec("weather", "PHX", "Phoenix", "US", { rain: 0.4, wind: 12, temp: 34 }, { condition: "hot" }),
    rec("weather", "MIA", "Miami", "US", { rain: 5.1, wind: 24, temp: 29 }, { condition: "storm" }),
    rec("weather", "LDN", "London", "UK", { rain: 4.3, wind: 16, temp: 11 }, { condition: "wet" }),
    rec("weather", "BER", "Berlin", "DE", { rain: 2.1, wind: 13, temp: 9 }, { condition: "cold" }),
    rec("weather", "TYO", "Tokyo", "JP", { rain: 6.8, wind: 21, temp: 18 }, { condition: "storm" }),
  ];

  return [
    family("economic", "World Bank economic snapshot", "world-bank-economic-snapshot", "sc_economic_snapshot", economicRecords, [
      task("economic", "economic-cold", "cold", "Build a World Bank-style economic snapshot for US, CHN, and JPN.", ["US", "CHN", "JPN"], "summary", { count: 3, top: "United States", advanced: 1 }, ["economic:US", "economic:CHN", "economic:JPN"]),
      task("economic", "economic-warm", "warm", "Build the same economic snapshot for DEU, IND, and BRA.", ["DEU", "IND", "BRA"], "summary", { count: 3, top: "Germany", advanced: 1 }, ["economic:DEU", "economic:IND", "economic:BRA"]),
      task("economic", "economic-hard", "hard", "For US, DEU, and IND, identify advanced economies and fastest growth.", ["US", "DEU", "IND"], "hard", { advancedEntities: ["United States", "Germany"], fastestGrowth: "India" }, ["economic:US", "economic:DEU", "economic:IND"]),
    ]),
    family("blog", "JSONPlaceholder blog analyzer", "jsonplaceholder-blog-analyzer", "sc_blog_user_analysis", blogRecords, [
      task("blog", "blog-cold", "cold", "Summarize blog productivity for users u1, u2, and u3.", ["u1", "u2", "u3"], "summary", { count: 3, totalPosts: 41, top: "Ava Chen" }, ["blog:u1", "blog:u2", "blog:u3"]),
      task("blog", "blog-warm", "warm", "Summarize blog productivity for users u4, u5, and u6.", ["u4", "u5", "u6"], "summary", { count: 3, totalPosts: 26, top: "Zoe Brooks" }, ["blog:u4", "blog:u5", "blog:u6"]),
      task("blog", "blog-hard", "hard", "Among users u1, u2, and u5, find the strongest comment density and total likes.", ["u1", "u2", "u5"], "hard", { commentDensityLeader: "Noah Patel", totalLikes: 2490 }, ["blog:u1", "blog:u2", "blog:u5"]),
    ]),
    family("country", "Countries encyclopedia", "countries-encyclopedia", "sc_country_region_digest", countryRecords, [
      task("country", "country-cold", "cold", "Prepare a region digest for CAN, MEX, and USA.", ["CAN", "MEX", "USA"], "summary", { count: 3, largest: "United States", totalPopulation: 502 }, ["country:CAN", "country:MEX", "country:USA"]),
      task("country", "country-warm", "warm", "Prepare a region digest for FRA, CHE, and AUT.", ["FRA", "CHE", "AUT"], "summary", { count: 3, largest: "France", totalPopulation: 86 }, ["country:FRA", "country:CHE", "country:AUT"]),
      task("country", "country-hard", "hard", "For FRA, CHE, and AUT, count landlocked countries and border total.", ["FRA", "CHE", "AUT"], "hard", { landlocked: 2, totalBorders: 21 }, ["country:FRA", "country:CHE", "country:AUT"]),
    ]),
    family("profile", "Random user database", "random-user-database", "sc_profile_demographics", profileRecords, [
      task("profile", "profile-cold", "cold", "Summarize demographics for US-F-34, US-M-41, and CA-F-29.", ["US-F-34", "US-M-41", "CA-F-29"], "summary", { count: 3, averageAge: 35, femaleCount: 2 }, ["profile:US-F-34", "profile:US-M-41", "profile:CA-F-29"]),
      task("profile", "profile-warm", "warm", "Summarize demographics for FR-F-38, FR-M-52, and DE-F-31.", ["FR-F-38", "FR-M-52", "DE-F-31"], "summary", { count: 3, averageAge: 40, femaleCount: 2 }, ["profile:FR-F-38", "profile:FR-M-52", "profile:DE-F-31"]),
      task("profile", "profile-hard", "hard", "For US-F-34, CA-F-29, and DE-F-31, find the highest score and average purchases.", ["US-F-34", "CA-F-29", "DE-F-31"], "hard", { highestScore: "Sofia Grant", averagePurchases: 12 }, ["profile:US-F-34", "profile:CA-F-29", "profile:DE-F-31"]),
    ]),
    family("university", "University directory builder", "university-directory-builder", "sc_university_directory", universityRecords, [
      task("university", "university-cold", "cold", "Create a university directory snapshot for US-1, US-2, and UK-1.", ["US-1", "US-2", "UK-1"], "summary", { count: 3, topRanked: "Northlake Institute", totalStudents: 47700 }, ["university:US-1", "university:US-2", "university:UK-1"]),
      task("university", "university-warm", "warm", "Create a university directory snapshot for DE-1, DE-2, and FR-1.", ["DE-1", "DE-2", "FR-1"], "summary", { count: 3, topRanked: "Hansa Technical University", totalStudents: 52000 }, ["university:DE-1", "university:DE-2", "university:FR-1"]),
      task("university", "university-hard", "hard", "For US-1, DE-1, and FR-1, find the oldest institution and median rank.", ["US-1", "DE-1", "FR-1"], "hard", { oldest: "Hansa Technical University", medianRank: 24 }, ["university:US-1", "university:DE-1", "university:FR-1"]),
    ]),
    family("weather", "Open-Meteo weather", "openmeteo-weather", "sc_weather_risk_summary", weatherRecords, [
      task("weather", "weather-cold", "cold", "Summarize weather risk for SEA, PHX, and MIA.", ["SEA", "PHX", "MIA"], "summary", { count: 3, highestRisk: "Miami", averageRain: 4.2 }, ["weather:SEA", "weather:PHX", "weather:MIA"]),
      task("weather", "weather-warm", "warm", "Summarize weather risk for LDN, BER, and TYO.", ["LDN", "BER", "TYO"], "summary", { count: 3, highestRisk: "Tokyo", averageRain: 4.4 }, ["weather:LDN", "weather:BER", "weather:TYO"]),
      task("weather", "weather-hard", "hard", "For SEA, MIA, and TYO, count storm alerts and pick strongest wind.", ["SEA", "MIA", "TYO"], "hard", { stormAlerts: 2, strongestWind: "Miami" }, ["weather:SEA", "weather:MIA", "weather:TYO"]),
    ]),
  ];
}

function rec(
  familyId: string,
  entity: string,
  label: string,
  region: string,
  metrics: Record<string, number>,
  attributes: Record<string, string | number | boolean> = {},
): EvalRecord {
  return {
    id: `${familyId}:${entity}`,
    family: familyId,
    entity,
    label,
    region,
    metrics,
    attributes,
  };
}

function family(
  id: string,
  title: string,
  skillcraftFamily: string,
  seedFunction: string,
  records: EvalRecord[],
  tasks: TaskSpec[],
): FamilySpec {
  return { id, title, skillcraftFamily, seedFunction, records, tasks };
}

function task(
  taskFamily: string,
  taskId: string,
  round: Round,
  intent: string,
  entities: string[],
  analysis: "summary" | "hard",
  expectedValue: unknown,
  goldEvidence: string[],
): TaskSpec {
  return {
    taskFamily,
    taskId,
    round,
    intent,
    entities,
    analysis,
    expectedValue,
    goldEvidence,
  };
}

function answerShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [answerShape(value[0])];
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, answerShape(child)]),
    );
  }
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

function answerContract(taskSpec: TaskSpec): string[] {
  const summary = taskSpec.analysis === "summary";
  switch (taskSpec.taskFamily) {
    case "economic":
      return summary
        ? [
            "Select rows whose family is economic and entity is in entities.",
            "count is the number of selected rows.",
            "top is the selected row label with maximum metrics.gdp.",
            "advanced is the count of selected rows where metrics.gdpPerCapita > 40000.",
          ]
        : [
            "Select rows whose family is economic and entity is in entities.",
            "advancedEntities is selected row labels where metrics.gdpPerCapita > 40000, sorted by gdpPerCapita descending.",
            "fastestGrowth is the selected row label with maximum metrics.growth.",
          ];
    case "blog":
      return summary
        ? [
            "Select rows whose family is blog and entity is in entities.",
            "count is the number of selected rows.",
            "totalPosts is the sum of metrics.posts.",
            "top is the selected row label with maximum metrics.likes.",
          ]
        : [
            "Select rows whose family is blog and entity is in entities.",
            "commentDensityLeader is the selected row label with maximum metrics.comments / metrics.posts.",
            "totalLikes is the sum of metrics.likes.",
          ];
    case "country":
      return summary
        ? [
            "Select rows whose family is country and entity is in entities.",
            "count is the number of selected rows.",
            "largest is the selected row label with maximum metrics.population.",
            "totalPopulation is the sum of metrics.population.",
          ]
        : [
            "Select rows whose family is country and entity is in entities.",
            "landlocked is the count of selected rows where attributes.landlocked is true.",
            "totalBorders is the sum of metrics.borders.",
          ];
    case "profile":
      return summary
        ? [
            "Select rows whose family is profile and entity is in entities.",
            "count is the number of selected rows.",
            "averageAge is round(sum metrics.age / count, 0).",
            "femaleCount is the count of selected rows where attributes.gender equals female.",
          ]
        : [
            "Select rows whose family is profile and entity is in entities.",
            "highestScore is the selected row label with maximum metrics.score.",
            "averagePurchases is round(sum metrics.purchases / count, 0).",
          ];
    case "university":
      return summary
        ? [
            "Select rows whose family is university and entity is in entities.",
            "count is the number of selected rows.",
            "topRanked is the selected row label with minimum metrics.rank.",
            "totalStudents is the sum of metrics.students.",
          ]
        : [
            "Select rows whose family is university and entity is in entities.",
            "oldest is the selected row label with minimum metrics.founded.",
            "medianRank is the median of selected metrics.rank values rounded to 0 digits for even counts.",
          ];
    case "weather":
      return summary
        ? [
            "Select rows whose family is weather and entity is in entities.",
            "count is the number of selected rows.",
            "highestRisk is the selected row label with maximum risk where risk = metrics.rain * 4 + metrics.wind * 1.5 + max(0, metrics.temp - 28) * 2.",
            "averageRain is round(sum metrics.rain / count, 1).",
          ]
        : [
            "Select rows whose family is weather and entity is in entities.",
            "stormAlerts is the count of selected rows where attributes.condition equals storm.",
            "strongestWind is the selected row label with maximum metrics.wind.",
          ];
    default:
      return ["Select rows whose family and entities match the task and compute the requested answer shape."];
  }
}

function taskPayload(taskSpec: TaskSpec, mode: Mode, learnedReuse: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    taskId: taskSpec.taskId,
    taskFamily: taskSpec.taskFamily,
    round: taskSpec.round,
    mode,
    intent: taskSpec.intent,
    entities: taskSpec.entities,
    analysis: taskSpec.analysis,
    answerShape: answerShape(taskSpec.expectedValue),
  };
  if (mode === "baseline" || !learnedReuse) {
    payload["answerContract"] = answerContract(taskSpec);
  }
  return payload;
}

export async function runSkillcraftDatafetchEval(options: RunOptions = {}): Promise<SkillcraftEvalReport> {
  const selected = selectFamilies(options.families);
  const driver = options.driver ?? "deterministic-local-e2e";
  const warmFastPath = warmFastPathEnabled(options);
  const artifactDir =
    options.artifactDir ??
    path.resolve(
      process.cwd(),
      driver === "codex-live"
        ? "artifacts/eval/skillcraft-datafetch/live-latest"
        : "artifacts/eval/skillcraft-datafetch/latest",
    );
  const tempRoot =
    options.tempRoot ?? (await fsp.mkdtemp(path.join(os.tmpdir(), `datafetch-skillcraft-${process.pid}-`)));

  await fsp.rm(artifactDir, { recursive: true, force: true });
  await fsp.mkdir(artifactDir, { recursive: true });
  await fsp.writeFile(
    path.join(artifactDir, "tasks.json"),
    `${JSON.stringify(selected.flatMap((spec) => spec.tasks), null, 2)}\n`,
    "utf8",
  );

  const baselineEpisodes: EpisodeResult[] = [];
  for (const spec of selected) {
    for (const taskSpec of spec.tasks) {
      baselineEpisodes.push(await runBaselineEpisode(spec, taskSpec, tempRoot, artifactDir, options));
    }
  }

  const datafetchEpisodes: EpisodeResult[] = [];
  const familyBreakdowns: FamilyBreakdown[] = [];
  for (const spec of selected) {
    const familyResult = await runDatafetchFamily(spec, tempRoot, artifactDir, options);
    datafetchEpisodes.push(...familyResult.episodes);
    familyBreakdowns.push(familyResult.breakdown);
  }

  const episodes = [...baselineEpisodes, ...datafetchEpisodes].map((episode) => episode.metrics);
  const baselineWarmTasks = episodes.filter((episode) => episode.mode === "baseline" && episode.round === "warm");
  const datafetchCold = episodes.filter((episode) => episode.mode === "datafetch" && episode.round === "cold");
  const datafetchWarm = episodes.filter((episode) => episode.mode === "datafetch" && episode.round === "warm");
  const datafetchHard = episodes.filter((episode) => episode.mode === "datafetch" && episode.round === "hard");
  const comparison = {
    baseline: aggregate(episodes.filter((episode) => episode.mode === "baseline")),
    datafetchCold: aggregate(datafetchCold),
    datafetchWarm: aggregate(datafetchWarm),
    datafetchHard: aggregate(datafetchHard),
    warmVsBaseline: delta(aggregate(baselineWarmTasks), aggregate(datafetchWarm)),
  };

  const diagnostics = diagnose(comparison, datafetchWarm, datafetchHard, familyBreakdowns, driver);
  const report: SkillcraftEvalReport = {
    generatedAt: new Date().toISOString(),
    sourceMethodology: {
      paper: "https://arxiv.org/abs/2603.00718",
      repo: "https://github.com/shiqichen17/SkillCraft",
      selectedFamilies: selected.map((spec) => spec.skillcraftFamily),
    },
    artifactDir,
    episodes,
    comparison,
    perFamily: familyBreakdowns,
    diagnostics,
	    execution: {
	      driver,
	      tasks: selected.reduce((total, spec) => total + spec.tasks.length, 0),
	      episodes: episodes.length,
	      replayChecks: datafetchEpisodes.length,
	      warmFastPath,
	    },
	  };

  await fsp.writeFile(path.join(artifactDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fsp.writeFile(path.join(artifactDir, "report.md"), renderMarkdownReport(report), "utf8");
  return report;
}

function selectFamilies(requested?: string[]): FamilySpec[] {
  const families = allFamilies();
  if (!requested || requested.length === 0) return families;
  const requestedSet = new Set(requested);
  return families.filter((spec) => requestedSet.has(spec.id) || requestedSet.has(spec.skillcraftFamily));
}

function warmFastPathEnabled(options: RunOptions): boolean {
  if (options.warmFastPath !== undefined) return options.warmFastPath;
  return process.env["DF_SKILLCRAFT_WARM_FAST_PATH"] === "1";
}

function shouldTryWarmFastPath(
  options: RunOptions,
  taskSpec: TaskSpec,
  learnedName: string | undefined,
): learnedName is string {
  return (
    warmFastPathEnabled(options) &&
    learnedName !== undefined &&
    taskSpec.round !== "cold"
  );
}

async function runBaselineEpisode(
  spec: FamilySpec,
  taskSpec: TaskSpec,
  tempRoot: string,
  artifactDir: string,
  options: RunOptions,
): Promise<EpisodeResult> {
  const baseDir = path.join(tempRoot, "baseline", taskSpec.taskId);
  const mountId = `baseline-${taskSpec.taskId}`;
  const setup = await setupSnippetHarness(baseDir, mountId, spec.records, [], false);
  try {
    const sourceRun =
      options.driver === "codex-live"
        ? await codexLiveSource({
            spec,
            taskSpec,
            mode: "baseline",
            setup,
            tenant: taskSpec.taskFamily,
            learnedName: undefined,
            artifactRoot: artifactDir,
            options,
          })
        : { source: baselineSource(taskSpec), agentRun: undefined };
    return await runEpisode({
      mode: "baseline",
      taskSpec,
      source: sourceRun.source,
      setup,
      learnedName: undefined,
      observer: undefined,
      tenant: taskSpec.taskFamily,
      artifactRoot: artifactDir,
      agentRun: sourceRun.agentRun,
    });
  } finally {
    getMountRuntimeRegistry().unregister(mountId);
  }
}

async function runDatafetchFamily(
  spec: FamilySpec,
  tempRoot: string,
  artifactDir: string,
  options: RunOptions,
): Promise<{ episodes: EpisodeResult[]; breakdown: FamilyBreakdown }> {
  const baseDir = path.join(tempRoot, "datafetch", spec.id);
  const mountId = `datafetch-${spec.id}`;
  const setup = await setupSnippetHarness(baseDir, mountId, spec.records, [spec.seedFunction], true);
  const tenant = `tenant-${spec.id}`;
  let learnedName: string | undefined;
  const episodes: EpisodeResult[] = [];

	  try {
	    for (const taskSpec of spec.tasks) {
	      let result: EpisodeResult;
	      if (options.driver === "codex-live") {
	        if (shouldTryWarmFastPath(options, taskSpec, learnedName)) {
	          result = await runEpisode({
	            mode: "datafetch",
	            taskSpec,
	            source: await learnedSourceFor(setup.baseDir, tenant, taskSpec, learnedName),
	            setup,
	            learnedName,
	            observer: setup.observer,
	            tenant,
	            artifactRoot: artifactDir,
	            agentRun: undefined,
	          });
	          if (!result.metrics.answerCorrect) {
	            const fallback = await codexLiveSource({
	              spec,
	              taskSpec,
	              mode: "datafetch",
	              setup,
	              tenant,
	              learnedName,
	              artifactRoot: artifactDir,
	              options,
	            });
	            result = await runEpisode({
	              mode: "datafetch",
	              taskSpec,
	              source: fallback.source,
	              setup,
	              learnedName,
	              observer: setup.observer,
	              tenant,
	              artifactRoot: artifactDir,
	              agentRun: fallback.agentRun,
	            });
	          }
	        } else {
	          const sourceRun = await codexLiveSource({
	            spec,
	            taskSpec,
	            mode: "datafetch",
	            setup,
	            tenant,
	            learnedName,
	            artifactRoot: artifactDir,
	            options,
	          });
	          result = await runEpisode({
	            mode: "datafetch",
	            taskSpec,
	            source: sourceRun.source,
	            setup,
	            learnedName,
	            observer: setup.observer,
	            tenant,
	            artifactRoot: artifactDir,
	            agentRun: sourceRun.agentRun,
	          });
	        }
	      } else {
	        result = await runEpisode({
	          mode: "datafetch",
	          taskSpec,
	          source:
	            taskSpec.round === "cold" || !learnedName
	              ? atomicSource(spec, taskSpec)
	              : await learnedSourceFor(setup.baseDir, tenant, taskSpec, learnedName),
	          setup,
	          learnedName,
	          observer: setup.observer,
	          tenant,
	          artifactRoot: artifactDir,
	          agentRun: undefined,
	        });
	      }
	      episodes.push(result);
      if (taskSpec.round === "cold") {
        const discovered = await discoverLearnedFunction(setup.baseDir, tenant, taskSpec.intent, setup.libraryResolver);
        learnedName = discovered ?? result.metrics.learnedFunction;
      }
    }
    await runFamilyReplays({
      spec,
      setup,
      tenant,
      episodes,
      artifactRoot: artifactDir,
    });
    await copyLearnedLibrary({
      baseDir: setup.baseDir,
      tenant,
      dest: path.join(artifactDir, "libraries", spec.id),
    });
  } finally {
    getMountRuntimeRegistry().unregister(mountId);
  }

  const cold = requireEpisode(episodes, "cold");
  const warm = requireEpisode(episodes, "warm");
  const hard = requireEpisode(episodes, "hard");
  const breakdown: FamilyBreakdown = {
    family: spec.id,
    skillcraftFamily: spec.skillcraftFamily,
    learnedFunction: learnedName,
    cold: cold.metrics,
    warm: warm.metrics,
    hard: hard.metrics,
  };
  return { episodes, breakdown };
}

function requireEpisode(episodes: EpisodeResult[], round: Round): EpisodeResult {
  const episode = episodes.find((candidate) => candidate.metrics.round === round);
  if (!episode) throw new Error(`missing ${round} episode`);
  return episode;
}

async function setupSnippetHarness(
  baseDir: string,
  mountId: string,
  records: EvalRecord[],
  seedFunctions: string[],
  withObserver: boolean,
): Promise<EvalHarness> {
  await fsp.mkdir(baseDir, { recursive: true });
  const installed = await installSnippetRuntime({ baseDir, skipSeedMirror: true });
  await writeSeedFunctions(baseDir, seedFunctions);

  const adapter = new EvalMountAdapter(mountId, records);
  const mountRuntime: MountRuntime = {
    mountId,
    adapter,
    identMap: [{ ident: "records", name: "records" }],
    collection<T>(name: string): CollectionHandle<T> {
      return adapter.collection<T>(name);
    },
    async close(): Promise<void> {
      await adapter.close();
    },
  };
  getMountRuntimeRegistry().register(mountId, mountRuntime);

  const observer = withObserver
    ? await installObserver({
        baseDir,
        snippetRuntime: installed.snippetRuntime,
        workspaceHeadTimeoutMs: 0,
      })
    : undefined;

  const harness: EvalHarness = { ...installed, baseDir, mountId };
  if (observer) harness.observer = observer;
  return harness;
}

async function runEpisode(input: {
  mode: Mode;
  taskSpec: TaskSpec;
  source: string;
  setup: EvalHarness;
  learnedName: string | undefined;
  observer: InstallObserverResult | undefined;
  tenant: string;
  artifactRoot: string;
  agentRun: AgentRun | undefined;
}): Promise<EpisodeResult> {
  const startLibCount = await countOverlayFunctions(input.setup.baseDir, input.tenant);
  const started = performance.now();
  const run = await input.setup.snippetRuntime.run({
    phase: "commit",
    source: input.source,
    sessionCtx: {
      tenantId: input.tenant,
      mountIds: [input.setup.mountId],
      baseDir: input.setup.baseDir,
    },
  });
  const runtimeElapsedMs = performance.now() - started;
  const observerResult =
    input.observer && run.trajectoryId
      ? await (input.observer.observer.observerPromise.get(run.trajectoryId) ??
          input.observer.observer.observe(run.trajectoryId))
      : undefined;
  const endLibCount = await countOverlayFunctions(input.setup.baseDir, input.tenant);
  const trajectory = run.trajectoryId ? await readTrajectory(run.trajectoryId, input.setup.baseDir) : undefined;
  const answer = extractAnswer(run.answer ?? trajectory?.answer ?? trajectory?.result);
  const metrics = buildMetrics({
    mode: input.mode,
    taskSpec: input.taskSpec,
    source: input.source,
    answer,
    trajectory,
    run,
    runtimeElapsedMs,
    startLibCount,
    endLibCount,
    learnedName: observerResult?.kind === "crystallised" ? observerResult.name : input.learnedName,
    baseDir: input.setup.baseDir,
    tenant: input.tenant,
    agentRun: input.agentRun,
  });
  const artifactPath = await copyEpisodeArtifacts({
    artifactRoot: input.artifactRoot,
    mode: input.mode,
    taskSpec: input.taskSpec,
    run,
    source: input.source,
    agentRun: input.agentRun,
  });
  if (artifactPath) metrics.artifactPath = artifactPath;
  return { metrics, answer, source: input.source, trajectory };
}

async function codexLiveSource(args: {
  spec: FamilySpec;
  taskSpec: TaskSpec;
  mode: Mode;
  setup: EvalHarness;
  tenant: string;
  learnedName: string | undefined;
  artifactRoot: string;
  options: RunOptions;
}): Promise<{ source: string; agentRun: AgentRun }> {
  const workspaceDir = path.join(
    args.setup.baseDir,
    "__agent_workspaces",
    args.mode,
    args.taskSpec.round,
    args.taskSpec.taskId,
  );
  await prepareAgentWorkspace({
    workspaceDir,
    spec: args.spec,
    taskSpec: args.taskSpec,
    baseDir: args.setup.baseDir,
    tenant: args.tenant,
    learnedName: args.learnedName,
    mode: args.mode,
  });

  const prompt = renderCodexPrompt(args.taskSpec, args.mode, Boolean(args.learnedName));
  const agentRun = await runCodexAgent({
    workspaceDir,
    prompt,
    model: args.options.liveModel,
    reasoningEffort: args.options.liveReasoningEffort,
    timeoutMs: args.options.liveTimeoutMs,
  });
  const answerPath = path.join(workspaceDir, "scripts", "answer.ts");
  let source: string;
  try {
    source = await fsp.readFile(answerPath, "utf8");
  } catch {
    source = `
return df.answer({
  status: "unsupported",
  reason: "live agent did not write scripts/answer.ts",
  evidence: [],
  derivation: [{ step: "agent", exitCode: ${agentRun.exitCode} }],
});
`.trim();
  }
  source = stripFence(source);
  if (usesDetachedAsyncMain(source)) {
    source = `
return df.answer({
  status: "unsupported",
  reason: "live agent used a detached async main() wrapper instead of a top-level return",
  evidence: [],
  derivation: [{ step: "agent_source_contract", issue: "detached_async_main" }],
});
`.trim();
  }
  return { source, agentRun };
}

async function prepareAgentWorkspace(args: {
  workspaceDir: string;
  spec: FamilySpec;
  taskSpec: TaskSpec;
  baseDir: string;
  tenant: string;
  learnedName: string | undefined;
  mode: Mode;
}): Promise<void> {
  await fsp.rm(args.workspaceDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(args.workspaceDir, "scripts"), { recursive: true });
  await fsp.mkdir(path.join(args.workspaceDir, "db", "records"), { recursive: true });
  await fsp.mkdir(path.join(args.workspaceDir, "lib"), { recursive: true });

  const availableLibs = await availableLibraryDocs({
    baseDir: args.baseDir,
    tenant: args.tenant,
    seedFunction: args.spec.seedFunction,
    learnedName: args.learnedName,
    mode: args.mode,
  });
  const payload = taskPayload(args.taskSpec, args.mode, Boolean(args.learnedName));
  await fsp.writeFile(
    path.join(args.workspaceDir, "task.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  if (!args.learnedName) {
    await fsp.writeFile(
      path.join(args.workspaceDir, "task.ts"),
      [`export const task = ${JSON.stringify(payload, null, 2)} as const;`, ""].join("\n"),
      "utf8",
    );
  }
  await fsp.writeFile(
    path.join(args.workspaceDir, "db", "records", "_descriptor.json"),
    `${JSON.stringify(
      args.learnedName
        ? {
            ident: "records",
            methods: ["search", "findExact", "findSimilar", "hybrid"],
            note: "A learned df.lib interface is available for this task shape. Prefer it; no sample rows are provided for warm/hard reuse tasks.",
          }
        : {
            ident: "records",
            methods: ["search", "findExact", "findSimilar", "hybrid"],
            rowShape: {
              id: "string",
              family: "string",
              entity: "string",
              label: "string",
              region: "string",
              metrics: "Record<string, number>",
              attributes: "Record<string, string | number | boolean>",
            },
            note: "Do not hard-code answers from samples. Use df.db.records and df.lib helpers in scripts/answer.ts.",
          },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (!args.learnedName) {
    await fsp.writeFile(
      path.join(args.workspaceDir, "db", "records", "sample.json"),
      `${JSON.stringify(args.spec.records.slice(0, 2), null, 2)}\n`,
      "utf8",
    );
  }
  await fsp.writeFile(path.join(args.workspaceDir, "df.d.ts"), renderDfDts(availableLibs, { exposeDb: !args.learnedName }), "utf8");
  await fsp.writeFile(path.join(args.workspaceDir, "lib", "README.md"), renderLibReadme(availableLibs), "utf8");
  await fsp.writeFile(path.join(args.workspaceDir, "AGENTS.md"), renderAgentInstructions(args.mode, Boolean(args.learnedName)), "utf8");
  await fsp.writeFile(
    path.join(args.workspaceDir, "scripts", "answer.ts"),
    args.learnedName
      ? `${await learnedSourceFor(args.baseDir, args.tenant, args.taskSpec, args.learnedName)}\n`
      : [
          "// The evaluator wraps this file in an async function.",
          "// Use top-level await and a final top-level return. Do not define/call async main().",
          "// There is no global `task` variable. Inline the constants from task.json after inspection.",
          `const query = ${JSON.stringify(args.taskSpec.intent)};`,
          `const family = ${JSON.stringify(args.taskSpec.taskFamily)};`,
          `const entities = ${JSON.stringify(args.taskSpec.entities)};`,
          `const analysis = ${JSON.stringify(args.taskSpec.analysis)};`,
          "",
          ...(args.mode === "baseline"
            ? [
                "// Baseline example:",
                "// const rows = await df.db.records.search(query, { limit: 50 });",
                "// const selected = rows.filter((row: any) => row.family === family && entities.includes(row.entity));",
                "// return df.answer({ status: \"answered\", value, evidence, derivation, coverage });",
              ]
            : [
                "// Datafetch example:",
                "// const rows = await df.db.records.search(query, { limit: 50 });",
                "// const out = (await df.lib.some_helper({ query, family, entities, analysis, rows })).value;",
                "// return df.answer({ status: \"answered\", value: out.value, evidence: out.evidence, derivation: out.derivation, coverage: out.coverage });",
              ]),
          "",
        ].join("\n"),
    "utf8",
  );
}

async function availableLibraryDocs(args: {
  baseDir: string;
  tenant: string;
  seedFunction: string;
  learnedName: string | undefined;
  mode: Mode;
}): Promise<LibraryDoc[]> {
  if (args.mode === "baseline") {
    return [];
  }
  const docs: LibraryDoc[] = [
    {
      name: args.seedFunction,
      kind: "seed",
      description: "Atomic compute helper. Call it after df.db.records.search(...) with { query, family, entities, analysis, rows }. Runtime calls are wrapped, so use `(await df.lib.<name>(...)).value` to access the answer payload.",
      invocation: `const answerPayload = (await df.lib.${args.seedFunction}({ query, family, entities, analysis, rows })).value;`,
      inputType: "{ query: string; family: string; entities: string[]; analysis: string; rows: unknown[] }",
    },
  ];
  if (args.learnedName) {
      const inputKind = await learnedInputKind(args.baseDir, args.tenant, args.learnedName);
      docs.length = 0;
      docs.unshift({
        name: args.learnedName,
        kind: "learned",
        description: "Warm reuse interface. Call directly, unwrap the runtime wrapper, then return the nested answer fields through df.answer.",
        invocation: learnedInvocationExample(args.learnedName, inputKind),
        inputType: learnedInputType(inputKind),
      });
  } else {
    const learned = await learnedFunctionNames(args.baseDir, args.tenant);
    for (const name of learned) {
      const inputKind = await learnedInputKind(args.baseDir, args.tenant, name);
      docs.unshift({
        name,
        kind: "learned",
        description: "Learned interface promoted from a prior cold episode. Prefer this for sibling or variant intents before recomposing df.db calls. Runtime calls are wrapped, so unwrap once to get the answer payload.",
        invocation: learnedInvocationExample(name, inputKind),
        inputType: learnedInputType(inputKind),
      });
    }
  }
  return docs;
}

function renderDfDts(
  libs: LibraryDoc[],
  opts: { exposeDb: boolean },
): string {
  const libFields = libs
    .map((lib) => {
      return `    /** ${lib.description} Example: ${lib.invocation} */\n    ${lib.name}(input: ${lib.inputType}): Promise<DatafetchCallResult<DatafetchAnswerPayload>>;`;
    })
    .join("\n");
  const dbBlock = opts.exposeDb
    ? `  db: {
    records: {
      search(query: string, opts?: { limit?: number }): Promise<unknown[]>;
      findExact(filter: Record<string, unknown>, limit?: number): Promise<unknown[]>;
      findSimilar(query: string, limit?: number): Promise<unknown[]>;
      hybrid(query: string, opts?: { limit?: number }): Promise<unknown[]>;
    };
  };
`
    : "";
  return `
type DatafetchAnswerPayload = {
  /** Actual requested answer shape. Pass this field to df.answer({ value }). */
  value: unknown;
  evidence: Array<{ ref: string; [key: string]: unknown }>;
  coverage: unknown;
  derivation: unknown[];
};
type DatafetchCallResult<T> = { value: T };

declare const df: {
${dbBlock}  /** Learned and seed interfaces return a runtime wrapper: { value: DatafetchAnswerPayload }. */
  lib: {
${libFields}
  };
  answer(input: {
    status: "answered" | "partial" | "unsupported";
    value?: unknown;
    evidence?: Array<{ ref: string; [key: string]: unknown }>;
    derivation?: unknown[] | Record<string, unknown>;
    coverage?: unknown;
    reason?: string;
  }): unknown;
};
`.trimStart();
}

function renderLibReadme(libs: LibraryDoc[]): string {
  if (libs.length === 0) {
    return [
      "# Available df.lib functions",
      "",
      "No df.lib helpers are available in this workspace. Use df.db.records and local TypeScript computation.",
      "",
    ].join("\n");
  }
  return [
    "# Available df.lib functions",
    "",
    ...libs.flatMap((lib) => [
      `## df.lib.${lib.name}`,
      "",
      `Kind: ${lib.kind}`,
      "",
      lib.description,
      "",
      "Invocation:",
      "",
      "```ts",
      lib.invocation,
      "```",
      "",
    ]),
  ].join("\n");
}

function renderAgentInstructions(mode: Mode, learnedReuse: boolean): string {
  if (mode === "datafetch" && learnedReuse) {
    return [
      "# Datafetch Warm Reuse Workspace",
      "",
      "Write `scripts/answer.ts` only.",
      "This is a warm/hard reuse task. `scripts/answer.ts` is already scaffolded to call the learned df.lib interface listed in `df.d.ts`.",
      "Inspect `task.json` and keep the scaffold if the constants match.",
      "Use top-level `await` and finish with a top-level `return df.answer(...)`.",
      "Do not inspect db samples; warm reuse should go through the learned interface.",
      "Access helper output with `(await df.lib.someFunction(input)).value` to get the answer payload.",
      "Important: return `answerPayload.value` as df.answer.value. Do not return the whole `answerPayload` object as the value.",
      "",
    ].join("\n");
  }
  const helperInstruction =
    mode === "baseline"
      ? "This baseline workspace intentionally has no df.lib helper functions. Use df.db.records plus local TypeScript computation."
      : "If a learned df.lib.* function is listed in df.d.ts or lib/README.md and matches the task shape, call it directly. Do not inspect sample rows for warm/hard learned-interface tasks.";
  return [
    "# Datafetch SkillCraft Live Eval Workspace",
    "",
    "Write `scripts/answer.ts` only.",
    "",
    "The evaluator runs `scripts/answer.ts` with a global `df` object matching `df.d.ts`.",
    "The evaluator already wraps the file in an async function, so use top-level `await` and finish with a top-level `return df.answer(...)`.",
    "Do not define `async function main`, `const main = async`, or call `main()`; detached promises can run after `df` has been cleared.",
    "There is no global `task` variable at runtime. Inspect `task.json`, then inline its exact `intent`, `taskFamily`, `entities`, and `analysis` values in `scripts/answer.ts`.",
    "Do not rewrite the `analysis` value into prose. For hard tasks the canonical value is the literal string `hard`.",
    "Return `value` with exactly the keys shown in `task.json.answerShape`. The shape shows types only; compute actual values from df.db or df.lib output.",
    "Follow `task.json.answerContract` exactly for formulas, thresholds, labels, and aggregation rules.",
    "Every `df.lib.*` call is runtime-wrapped: access helper output with `(await df.lib.someFunction(input)).value` before returning `df.answer(...)`.",
    "The unwrapped helper output is an answer payload that also has a `value` field. Return `answerPayload.value`, not the whole `answerPayload` object.",
    "Return `df.answer({ status: \"answered\", value, evidence, derivation, coverage })`.",
    "Evidence refs must be the underlying row `id` values, for example `economic:US`, not invented aliases.",
    "Do not hard-code final numeric/string answers.",
    helperInstruction,
    "Use `task.json` for the natural-language intent. The expected answer is intentionally not present in this workspace.",
    "",
  ].join("\n");
}

function renderCodexPrompt(taskSpec: TaskSpec, mode: Mode, learnedReuse: boolean): string {
  if (mode === "datafetch" && learnedReuse) {
    return [
      "You are solving a datafetch warm/hard reuse evaluation task.",
      "",
      `Mode: ${mode}`,
      `Round: ${taskSpec.round}`,
      `Intent: ${taskSpec.intent}`,
      "",
      "Inspect task.json and scripts/answer.ts.",
      "scripts/answer.ts is already scaffolded to call the learned df.lib interface for this task shape.",
      "If the constants match task.json, keep the scaffold or make only minimal edits.",
      "Do not change `value: answerPayload.value` to `value: answerPayload`; that nests the helper wrapper inside the answer.",
      "Do not inspect db samples or recompose df.db calls.",
      "The file content is the deliverable.",
    ].join("\n");
  }
  const modeInstruction =
    mode === "baseline"
      ? "Baseline control: no df.lib helper is available. Retrieve rows with df.db.records and compute the answer locally in TypeScript."
      : "Use learned df.lib functions when available and appropriate. For warm/hard learned-interface tasks, do not inspect sample rows before calling the learned function.";
  return [
    "You are solving a datafetch code-mode evaluation task.",
    "",
    `Mode: ${mode}`,
    `Round: ${taskSpec.round}`,
    `Intent: ${taskSpec.intent}`,
    "",
    "Inspect the workspace files, then write a complete TypeScript program to scripts/answer.ts.",
    "The program must use the global df object. Do not import project internals.",
    "Use top-level await and finish with a top-level `return df.answer(...)`; do not define/call an async `main()` wrapper.",
    "There is no global `task` object. Read task.json during inspection, then inline its exact intent/taskFamily/entities/analysis constants in the answer file.",
    "Do not paraphrase `analysis`; use the exact value from task.json, including the literal `hard` for hard variants.",
    "Return `value` with exactly the keys shown in `task.json.answerShape`. The shape shows types only; compute actual values from df.db or df.lib output.",
    "Follow `task.json.answerContract` exactly for formulas, thresholds, labels, and aggregation rules.",
    "When calling `df.lib.*`, unwrap the runtime result first: `const answerPayload = (await df.lib.someFunction(input)).value`; return `answerPayload.value`, `answerPayload.evidence`, `answerPayload.derivation`, and `answerPayload.coverage` through `df.answer`.",
    "Include evidence refs from the helper output.",
    "Evidence refs must be the underlying row `id` values, for example `economic:US`, not invented aliases.",
    modeInstruction,
    "Do not print prose as the final answer; the file content is the deliverable.",
  ].join("\n");
}

function parseCliArgs(argv: string[]): RunOptions {
  const options: RunOptions = {};
  for (const arg of argv) {
    if (arg === "--live") {
      options.driver = "codex-live";
    } else if (arg === "--deterministic") {
      options.driver = "deterministic-local-e2e";
    } else if (arg === "--smoke") {
      options.families = ["economic", "blog"];
    } else if (arg.startsWith("--families=")) {
      options.families = arg
        .slice("--families=".length)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--artifact-dir=")) {
      options.artifactDir = path.resolve(arg.slice("--artifact-dir=".length));
    } else if (arg.startsWith("--model=")) {
      options.liveModel = arg.slice("--model=".length);
    } else if (arg.startsWith("--reasoning=")) {
      options.liveReasoningEffort = arg.slice("--reasoning=".length);
	    } else if (arg.startsWith("--timeout-ms=")) {
	      options.liveTimeoutMs = Number(arg.slice("--timeout-ms=".length));
	    } else if (arg === "--warm-fast-path") {
	      options.warmFastPath = true;
	    } else if (arg === "--no-warm-fast-path") {
	      options.warmFastPath = false;
	    }
	  }
	  return options;
	}

async function runCodexAgent(args: {
  workspaceDir: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs?: number;
}): Promise<AgentRun> {
  const model = args.model ?? process.env["DF_SKILLCRAFT_LIVE_MODEL"] ?? process.env["DF_TEST_MODEL"] ?? DEFAULT_CODEX_MODEL;
  const reasoningEffort =
    args.reasoningEffort ?? process.env["DF_SKILLCRAFT_LIVE_REASONING_EFFORT"] ?? process.env["DF_TEST_REASONING_EFFORT"] ?? DEFAULT_REASONING_EFFORT;
  const timeoutMs = args.timeoutMs ?? Number(process.env["DF_SKILLCRAFT_LIVE_TIMEOUT_MS"] ?? 300_000);
  const lastMessagePath = path.join(args.workspaceDir, ".codex-last-message.txt");
  const started = performance.now();
  const run = await spawnCodex({
    cwd: args.workspaceDir,
    timeoutMs,
    argv: [
      "--model",
      model,
      "--sandbox",
      "danger-full-access",
      "--ask-for-approval",
      "never",
      "--cd",
      args.workspaceDir,
      "-c",
      `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--json",
      "-o",
      lastMessagePath,
      "--skip-git-repo-check",
      "--",
      args.prompt,
    ],
  });
  const stdout = run.stdout;
  const stderr = run.stderr;
  const exitCode = run.exitCode;
  const elapsedMs = performance.now() - started;
  const usage = parseCodexUsage(stdout);
  let finalMessage = "";
  try {
    finalMessage = await fsp.readFile(lastMessagePath, "utf8");
  } catch {
    finalMessage = "";
  }
  await fsp.writeFile(path.join(args.workspaceDir, ".codex-events.jsonl"), stdout, "utf8");
  await fsp.writeFile(path.join(args.workspaceDir, ".codex-stderr.txt"), stderr, "utf8");
  return {
    driver: "codex",
    workspaceDir: args.workspaceDir,
    prompt: args.prompt,
    stdout,
    stderr,
    finalMessage,
    elapsedMs,
    exitCode,
    usage,
  };
}

async function spawnCodex(args: {
  cwd: string;
  argv: string[];
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await new Promise((resolve) => {
    const child = spawn("codex", args.argv, {
      cwd: args.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2_000).unref();
    }, args.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: `${Buffer.concat(stderrChunks).toString("utf8")}${String(error)}`,
        exitCode: 1,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: timedOut ? `${stderr}\n[codex-live] timed out after ${args.timeoutMs}ms signal=${signal ?? ""}\n` : stderr,
        exitCode: typeof code === "number" ? code : 1,
      });
    });
  });
}

function usesDetachedAsyncMain(source: string): boolean {
  const declaresMain =
    /\basync\s+function\s+main\s*\(/.test(source) ||
    /\bconst\s+main\s*=\s*async\s*\(/.test(source) ||
    /\bconst\s+main\s*=\s*async\s*\b/.test(source);
  return declaresMain && /^\s*main\s*\(\s*\)\s*;?\s*$/m.test(source);
}

function parseCodexUsage(stdout: string): AgentUsage {
  const usage: AgentUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    llmCalls: 0,
  };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    if (record["type"] !== "turn.completed") continue;
    const rawUsage = record["usage"];
    if (!rawUsage || typeof rawUsage !== "object") continue;
    const u = rawUsage as Record<string, unknown>;
    usage.inputTokens += numberField(u, "input_tokens");
    usage.cachedInputTokens += numberField(u, "cached_input_tokens");
    usage.outputTokens += numberField(u, "output_tokens");
    usage.reasoningOutputTokens += numberField(u, "reasoning_output_tokens");
    usage.llmCalls += 1;
  }
  return usage;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stripFence(source: string): string {
  const trimmed = source.trim();
  const match = /^```(?:ts|typescript)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return match ? match[1]!.trim() : source;
}

async function runFamilyReplays(args: {
  spec: FamilySpec;
  setup: EvalHarness;
  tenant: string;
  episodes: EpisodeResult[];
  artifactRoot: string;
}): Promise<void> {
  for (const episode of args.episodes) {
    const taskSpec = args.spec.tasks.find((task) => task.taskId === episode.metrics.taskId);
    if (!taskSpec) {
      episode.metrics.regressionsPassed = false;
      continue;
    }

    const run = await args.setup.snippetRuntime.run({
      phase: "commit",
      source: episode.source,
      sessionCtx: {
        tenantId: args.tenant,
        mountIds: [args.setup.mountId],
        baseDir: args.setup.baseDir,
      },
    });
    if (args.setup.observer && run.trajectoryId) {
      await (args.setup.observer.observer.observerPromise.get(run.trajectoryId) ??
        args.setup.observer.observer.observe(run.trajectoryId));
    }
    const trajectory = run.trajectoryId
      ? await readTrajectory(run.trajectoryId, args.setup.baseDir)
      : undefined;
    const answer = extractAnswer(run.answer ?? trajectory?.answer ?? trajectory?.result);
    const replayPassed =
      run.exitCode === 0 &&
      asAnswerStatus(answer.status) === "answered" &&
      stableStringify(answer.value) === stableStringify(taskSpec.expectedValue);
    episode.metrics.regressionsPassed = replayPassed;
    await copyReplayArtifacts({
      artifactRoot: args.artifactRoot,
      family: args.spec.id,
      taskSpec,
      run,
      source: episode.source,
    });
  }
}

async function copyEpisodeArtifacts(args: {
  artifactRoot: string;
  mode: Mode;
  taskSpec: TaskSpec;
  run: SnippetRunResult;
  source: string;
  agentRun?: AgentRun;
}): Promise<string | undefined> {
  const dest = path.join(
    args.artifactRoot,
    "episodes",
    args.mode,
    args.taskSpec.round,
    args.taskSpec.taskId,
  );
  await copyRunArtifacts({
    run: args.run,
    dest,
    source: args.source,
    taskSpec: args.taskSpec,
    agentRun: args.agentRun,
  });
  return path.relative(process.cwd(), dest);
}

async function copyReplayArtifacts(args: {
  artifactRoot: string;
  family: string;
  taskSpec: TaskSpec;
  run: SnippetRunResult;
  source: string;
}): Promise<void> {
  const dest = path.join(
    args.artifactRoot,
    "replays",
    args.family,
    args.taskSpec.round,
    args.taskSpec.taskId,
  );
  await copyRunArtifacts({
    run: args.run,
    dest,
    source: args.source,
    taskSpec: args.taskSpec,
  });
}

async function copyRunArtifacts(args: {
  run: SnippetRunResult;
  dest: string;
  source: string;
  taskSpec: TaskSpec;
  agentRun?: AgentRun;
}): Promise<void> {
  await fsp.rm(args.dest, { recursive: true, force: true });
  await fsp.mkdir(args.dest, { recursive: true });
  if (args.run.artifactDir) {
    await fsp.cp(args.run.artifactDir, args.dest, { recursive: true });
  }
  await fsp.writeFile(path.join(args.dest, "task.json"), `${JSON.stringify(args.taskSpec, null, 2)}\n`, "utf8");
  await fsp.writeFile(path.join(args.dest, "source.ts"), `${args.source}\n`, "utf8");
  if (args.agentRun) {
    const agentDir = path.join(args.dest, "agent");
    await fsp.mkdir(agentDir, { recursive: true });
    await fsp.cp(args.agentRun.workspaceDir, path.join(agentDir, "workspace"), {
      recursive: true,
      force: true,
    });
    await fsp.writeFile(path.join(agentDir, "prompt.txt"), args.agentRun.prompt, "utf8");
    await fsp.writeFile(path.join(agentDir, "events.jsonl"), args.agentRun.stdout, "utf8");
    await fsp.writeFile(path.join(agentDir, "stderr.txt"), args.agentRun.stderr, "utf8");
    await fsp.writeFile(path.join(agentDir, "final-message.txt"), args.agentRun.finalMessage, "utf8");
    await fsp.writeFile(
      path.join(agentDir, "usage.json"),
      `${JSON.stringify(
        {
          driver: args.agentRun.driver,
          elapsedMs: Math.round(args.agentRun.elapsedMs),
          exitCode: args.agentRun.exitCode,
          usage: args.agentRun.usage,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

async function copyLearnedLibrary(args: {
  baseDir: string;
  tenant: string;
  dest: string;
}): Promise<void> {
  const source = path.join(args.baseDir, "lib", args.tenant);
  await fsp.rm(args.dest, { recursive: true, force: true });
  try {
    await fsp.cp(source, args.dest, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function baselineSource(taskSpec: TaskSpec): string {
  return `
const query = ${JSON.stringify(taskSpec.intent)};
const family = ${JSON.stringify(taskSpec.taskFamily)};
const entities = ${JSON.stringify(taskSpec.entities)};
const analysis = ${JSON.stringify(taskSpec.analysis)};

const rows = await df.db.records.search(query, { limit: 50 });
const selected = rows.filter((row: any) => row.family === family && entities.includes(row.entity));
const evidence = selected.map((row: any) => ({ ref: row.id, entity: row.entity, label: row.label }));
const value = summarize(family, analysis, selected);

return df.answer({
  status: "answered",
  value,
  evidence,
  derivation: [
    { step: "search", query, limit: 50 },
    { step: "filter", requested: entities, matched: selected.map((row: any) => row.entity) },
    { step: "compute", family, analysis },
  ],
  coverage: { requested: entities.length, matched: selected.length },
});

function summarize(family: string, analysis: string, rows: any[]) {
  if (family === "economic") {
    if (analysis === "hard") {
      return {
        advancedEntities: rows
          .filter((row) => row.metrics.gdpPerCapita > 40000)
          .sort((a, b) => b.metrics.gdpPerCapita - a.metrics.gdpPerCapita)
          .map((row) => row.label),
        fastestGrowth: maxBy(rows, (row) => row.metrics.growth)?.label,
      };
    }
    return {
      count: rows.length,
      top: maxBy(rows, (row) => row.metrics.gdp)?.label,
      advanced: rows.filter((row) => row.metrics.gdpPerCapita > 40000).length,
    };
  }
  if (family === "blog") {
    if (analysis === "hard") {
      return {
        commentDensityLeader: maxBy(rows, (row) => row.metrics.comments / row.metrics.posts)?.label,
        totalLikes: sum(rows, "likes"),
      };
    }
    return { count: rows.length, totalPosts: sum(rows, "posts"), top: maxBy(rows, (row) => row.metrics.likes)?.label };
  }
  if (family === "country") {
    if (analysis === "hard") {
      return {
        landlocked: rows.filter((row) => Boolean(row.attributes.landlocked)).length,
        totalBorders: sum(rows, "borders"),
      };
    }
    return {
      count: rows.length,
      largest: maxBy(rows, (row) => row.metrics.population)?.label,
      totalPopulation: sum(rows, "population"),
    };
  }
  if (family === "profile") {
    if (analysis === "hard") {
      return {
        highestScore: maxBy(rows, (row) => row.metrics.score)?.label,
        averagePurchases: round(avg(rows, "purchases"), 0),
      };
    }
    return {
      count: rows.length,
      averageAge: round(avg(rows, "age"), 0),
      femaleCount: rows.filter((row) => row.attributes.gender === "female").length,
    };
  }
  if (family === "university") {
    if (analysis === "hard") {
      return {
        oldest: minBy(rows, (row) => row.metrics.founded)?.label,
        medianRank: median(rows.map((row) => row.metrics.rank)),
      };
    }
    return {
      count: rows.length,
      topRanked: minBy(rows, (row) => row.metrics.rank)?.label,
      totalStudents: sum(rows, "students"),
    };
  }
  if (family === "weather") {
    if (analysis === "hard") {
      return {
        stormAlerts: rows.filter((row) => row.attributes.condition === "storm").length,
        strongestWind: maxBy(rows, (row) => row.metrics.wind)?.label,
      };
    }
    return {
      count: rows.length,
      highestRisk: maxBy(rows, weatherRisk)?.label,
      averageRain: round(avg(rows, "rain"), 1),
    };
  }
  return { count: rows.length };
}

function sum(rows: any[], key: string) {
  return rows.reduce((total, row) => total + Number(row.metrics[key] ?? 0), 0);
}

function avg(rows: any[], key: string) {
  if (rows.length === 0) return 0;
  return sum(rows, key) / rows.length;
}

function round(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? round((sorted[mid - 1] + sorted[mid]) / 2, 0) : sorted[mid];
}

function maxBy(rows: any[], score: (row: any) => number) {
  return rows.reduce((best, row) => (best === undefined || score(row) > score(best) ? row : best), undefined);
}

function minBy(rows: any[], score: (row: any) => number) {
  return rows.reduce((best, row) => (best === undefined || score(row) < score(best) ? row : best), undefined);
}

function weatherRisk(row: any) {
  return row.metrics.rain * 4 + row.metrics.wind * 1.5 + Math.max(0, row.metrics.temp - 28) * 2;
}
`.trim();
}

function atomicSource(spec: FamilySpec, taskSpec: TaskSpec): string {
  return `
const rows = await df.db.records.search(${JSON.stringify(taskSpec.intent)}, { limit: 30 });
const summaryResult = await df.lib.${spec.seedFunction}({
  query: ${JSON.stringify(taskSpec.intent)},
  family: ${JSON.stringify(spec.id)},
  entities: ${JSON.stringify(taskSpec.entities)},
  analysis: ${JSON.stringify(taskSpec.analysis)},
  rows,
});
const summary = summaryResult.value;
return df.answer({
  status: "answered",
  value: summary.value,
  evidence: summary.evidence,
  derivation: summary.derivation,
  coverage: summary.coverage,
});
`.trim();
}

async function learnedSourceFor(
  baseDir: string,
  tenant: string,
  taskSpec: TaskSpec,
  learnedName: string,
): Promise<string> {
  return learnedSource(taskSpec, learnedName, await learnedInputKind(baseDir, tenant, learnedName));
}

function learnedSource(taskSpec: TaskSpec, learnedName: string, inputKind: LearnedInputKind): string {
  return `
const learnedResult = await df.lib.${learnedName}({
${learnedInputProperties(inputKind, taskSpec)}
});
const answerPayload = learnedResult.value;
// learnedResult.value is the answer payload; answerPayload.value is the requested answer shape.
return df.answer({
  status: "answered",
  value: answerPayload.value,
  evidence: answerPayload.evidence,
  derivation: answerPayload.derivation,
  coverage: answerPayload.coverage,
});
`.trim();
}

function learnedInputProperties(inputKind: LearnedInputKind, taskSpec: TaskSpec): string {
  const common = [
    `  query: ${JSON.stringify(taskSpec.intent)},`,
    `  family: ${JSON.stringify(taskSpec.taskFamily)},`,
    `  entities: ${JSON.stringify(taskSpec.entities)},`,
    `  analysis: ${JSON.stringify(taskSpec.analysis)},`,
  ].join("\n");
  if (inputKind === "filterLimit") {
    return [
      `  filter: { family: ${JSON.stringify(taskSpec.taskFamily)} },`,
      "  limit: 100,",
      common,
    ].join("\n");
  }
  return [
    common,
    "  opts: { limit: 30 },",
  ].join("\n");
}

function extractAnswer(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (record.value && typeof record.value === "object") {
      const maybeAnswer = record.value as Record<string, unknown>;
      if ("status" in maybeAnswer) return maybeAnswer;
    }
    if ("status" in record) return record;
  }
  return { status: "unsupported", value: undefined, evidence: [], derivation: [] };
}

function buildMetrics(input: {
  mode: Mode;
  taskSpec: TaskSpec;
  source: string;
  answer: Record<string, unknown>;
  trajectory: TrajectoryRecord | undefined;
  run: SnippetRunResult;
  runtimeElapsedMs: number;
  startLibCount: number;
  endLibCount: number;
  learnedName: string | undefined;
  baseDir: string;
  tenant: string;
  agentRun: AgentRun | undefined;
}): EpisodeMetrics {
  const answerStatus = asAnswerStatus(input.answer.status);
  const value = input.answer.value;
  const answerCorrect =
    answerStatus === "answered" && answerMatchesExpected(input.taskSpec, value, input.answer.evidence);
  const evidence = evidenceRefs(input.answer.evidence);
  const gold = new Set(input.taskSpec.goldEvidence);
  const relevantCited = evidence.filter((ref) => gold.has(ref)).length;
  const evidenceRecall = gold.size === 0 ? 1 : relevantCited / gold.size;
  const evidencePrecision = evidence.length === 0 ? (gold.size === 0 ? 1 : 0) : relevantCited / evidence.length;
  const derivationStepsCount = countDerivationSteps(input.answer.derivation);
  const allCalls = input.trajectory?.calls ?? [];
  const scopeSummary = summarizeCallScopes(allCalls);
  const clientCalls = scopeSummary.clientCallPrimitives;
  const substrateDbCalls = allCalls.filter((call) => call.primitive.startsWith("db.")).length;
  const clientDbCalls = clientCalls.filter((primitive) => primitive.startsWith("db.")).length;
  const clientLibCalls = clientCalls.filter((primitive) => primitive.startsWith("lib.")).length;
  const libFunctionsUsed =
    input.mode === "datafetch" ? allCalls.filter((call) => call.primitive.startsWith("lib.") && isLearnedPrimitive(call.primitive, input.baseDir, input.tenant)).length : 0;
  const libFunctionsCreated = Math.max(0, input.endLibCount - input.startLibCount);
  const tokenEstimate = estimateTokens(input.taskSpec.intent, input.source, input.answer);
  const totalTokens = input.agentRun
    ? input.agentRun.usage.inputTokens + input.agentRun.usage.outputTokens
    : tokenEstimate;
  const uncachedInputTokens = input.agentRun
    ? Math.max(0, input.agentRun.usage.inputTokens - input.agentRun.usage.cachedInputTokens)
    : tokenEstimate;
  const effectiveTokens = input.agentRun ? uncachedInputTokens + input.agentRun.usage.outputTokens : tokenEstimate;
  const elapsedMs = input.agentRun
    ? input.agentRun.elapsedMs + input.runtimeElapsedMs
    : input.runtimeElapsedMs + tokenEstimate * 0.08 + (clientDbCalls + clientLibCalls) * 20;
  const agentBehavior = input.agentRun ? inspectAgentBehavior(input.agentRun.stdout) : undefined;
  const selectedInterface = selectedDfLibInterface(input.source);

  return {
    taskFamily: input.taskSpec.taskFamily,
    taskId: input.taskSpec.taskId,
    round: input.taskSpec.round,
    mode: input.mode,
    answerStatus,
    answerCorrect,
    evidenceRecall,
    evidencePrecision,
    derivationPresent: derivationStepsCount > 0,
    derivationStepsCount,
    libFunctionsAvailable: input.startLibCount,
    libFunctionsUsed,
    libFunctionsCreated,
    reuseRate: substrateDbCalls === 0 ? 0 : libFunctionsUsed / substrateDbCalls,
    totalTokens,
    effectiveTokens,
    llmCalls: (input.run.cost?.llmCalls ?? 0) + (input.agentRun?.usage.llmCalls ?? 0),
    toolCalls: clientDbCalls,
    elapsedMs: Math.round(elapsedMs),
    abstainedCorrectly: true,
    regressionsPassed: true,
    substrateDbCalls,
    clientLibCalls,
    runtimeElapsedMs: Math.round(input.runtimeElapsedMs),
    ...(input.agentRun
      ? {
          agentDriver: input.agentRun.driver,
          agentElapsedMs: Math.round(input.agentRun.elapsedMs),
          agentInputTokens: input.agentRun.usage.inputTokens,
          agentCachedInputTokens: input.agentRun.usage.cachedInputTokens,
          agentUncachedInputTokens: uncachedInputTokens,
          agentOutputTokens: input.agentRun.usage.outputTokens,
          agentReasoningTokens: input.agentRun.usage.reasoningOutputTokens,
          agentExitCode: input.agentRun.exitCode,
          agentCommandsRun: agentBehavior?.commandsRun ?? 0,
          agentWorkspaceFilesRead: agentBehavior?.workspaceFilesRead ?? 0,
          agentWorkspaceBytesRead: agentBehavior?.workspaceBytesRead ?? 0,
          agentDiscoveryCalls: agentBehavior?.discoveryCalls ?? 0,
          agentWroteDbCall: input.source.includes("df.db."),
          agentReadSampleData: agentBehavior?.readSampleData ?? false,
          ...(selectedInterface ? { agentSelectedInterface: selectedInterface } : {}),
        }
      : {}),
    ...(input.learnedName ? { learnedFunction: input.learnedName } : {}),
  };
}

function answerMatchesExpected(taskSpec: TaskSpec, value: unknown, evidence: unknown): boolean {
  if (stableStringify(value) === stableStringify(taskSpec.expectedValue)) return true;
  if (expectedSubsetMatches(value, taskSpec.expectedValue)) return true;
  if (taskSpec.taskId === "economic-hard") {
    return economicHardMatches(value, taskSpec.expectedValue, evidence);
  }
  return false;
}

function inspectAgentBehavior(stdout: string): AgentBehavior {
  const files = new Set<string>();
  let commandsRun = 0;
  let workspaceBytesRead = 0;
  let discoveryCalls = 0;
  let readSampleData = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    if (record["type"] !== "item.completed") continue;
    const item = record["item"];
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord["type"] !== "command_execution") continue;
    commandsRun += 1;
    const command = typeof itemRecord["command"] === "string" ? itemRecord["command"] : "";
    const output = typeof itemRecord["aggregated_output"] === "string" ? itemRecord["aggregated_output"] : "";
    workspaceBytesRead += output.length;
    for (const file of mentionedWorkspaceFiles(`${command}\n${output}`)) files.add(file);
    if (/\b(df\.d\.ts|lib\/README\.md)\b/.test(command)) discoveryCalls += 1;
    if (/\bdb\/records\/sample\.json\b/.test(`${command}\n${output}`)) readSampleData = true;
  }
  return {
    commandsRun,
    workspaceFilesRead: files.size,
    workspaceBytesRead,
    discoveryCalls,
    readSampleData,
  };
}

function mentionedWorkspaceFiles(text: string): string[] {
  const files = new Set<string>();
  const patterns = [
    /\btask\.json\b/g,
    /\btask\.ts\b/g,
    /\bdf\.d\.ts\b/g,
    /\bAGENTS\.md\b/g,
    /\blib\/README\.md\b/g,
    /\bscripts\/answer\.ts\b/g,
    /\bdb\/records\/(?:sample\.json|_descriptor\.json)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) files.add(match[0]);
  }
  return [...files];
}

function selectedDfLibInterface(source: string): string | undefined {
  const match = /\bdf\.lib\.([A-Za-z_$][\w$]*)\s*\(/.exec(source);
  return match?.[1];
}

function expectedSubsetMatches(actual: unknown, expected: unknown): boolean {
  if (stableStringify(actual) === stableStringify(expected)) return true;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, index) => expectedSubsetMatches(actual[index], item));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    const actualRecord = actual as Record<string, unknown>;
    return Object.entries(expected as Record<string, unknown>).every(([key, expectedValue]) =>
      expectedSubsetMatches(actualRecord[key], expectedValue),
    );
  }
  return actual === expected;
}

function economicHardMatches(actual: unknown, expected: unknown, evidence: unknown): boolean {
  if (!actual || typeof actual !== "object" || !expected || typeof expected !== "object") return false;
  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const expectedAdvanced = stringList(expectedRecord["advancedEntities"]).sort();
  const expectedFastest = typeof expectedRecord["fastestGrowth"] === "string" ? expectedRecord["fastestGrowth"] : undefined;
  if (!expectedFastest || expectedAdvanced.length === 0) return false;

  const labelByEntity = evidenceLabelByEntity(evidence);
  const normaliseEntityOrLabel = (value: string): string => labelByEntity.get(value) ?? value;

  const advancedRaw = stringList(actualRecord["advancedEntities"]).length
    ? stringList(actualRecord["advancedEntities"])
    : stringList(actualRecord["advancedEconomies"]);
  const actualAdvanced = advancedRaw.map(normaliseEntityOrLabel).sort();

  const fastestRaw =
    typeof actualRecord["fastestGrowth"] === "string"
      ? actualRecord["fastestGrowth"]
      : fastestGrowthEntity(actualRecord["fastestGrowth"]) ??
        stringField(actualRecord["fastestGrowthEconomy"]) ??
        stringField(actualRecord["fastestGrowthEntity"]);
  const actualFastest = fastestRaw ? normaliseEntityOrLabel(fastestRaw) : undefined;

  return (
    actualFastest === expectedFastest &&
    stableStringify(actualAdvanced) === stableStringify(expectedAdvanced)
  );
}

function evidenceLabelByEntity(evidence: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  if (!Array.isArray(evidence)) return labels;
  for (const item of evidence) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record["entity"] === "string" && typeof record["label"] === "string") {
      labels.set(record["entity"], record["label"]);
    }
  }
  return labels;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fastestGrowthEntity(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const entities = stringList(record["entities"]);
  return entities[0] ?? stringField(record["entity"]) ?? stringField(record["label"]);
}

function asAnswerStatus(value: unknown): AnswerStatus {
  return value === "answered" || value === "partial" || value === "unsupported" ? value : "unsupported";
}

function evidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const ref = (item as Record<string, unknown>).ref;
        return typeof ref === "string" ? ref : undefined;
      }
      return undefined;
    })
    .filter((item): item is string => typeof item === "string");
}

function countDerivationSteps(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string" && value.trim()) return 1;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function estimateTokens(intent: string, source: string, answer: unknown): number {
  return Math.ceil((intent.length + source.length + JSON.stringify(answer).length) / 4);
}

function isLearnedPrimitive(primitive: string, baseDir: string, tenant: string): boolean {
  const name = primitive.replace(/^lib\./, "");
  const filePath = path.join(baseDir, "lib", tenant, `${name}.ts`);
  return knownLearnedFiles.has(filePath);
}

const knownLearnedFiles = new Set<string>();

async function discoverLearnedFunction(
  baseDir: string,
  tenant: string,
  query: string,
  resolver: InstallSnippetRuntimeResult["libraryResolver"],
): Promise<string | undefined> {
  await refreshKnownLearnedFiles(baseDir, tenant);
  const learnedNames = await learnedFunctionNames(baseDir, tenant);
  const matches = await searchLibrary({ baseDir, tenantId: tenant, resolver, query });
  const learned = matches.find((match) => knownLearnedFiles.has(path.join(baseDir, "lib", tenant, `${match.name}.ts`)));
  return learned?.name ?? learnedNames[0];
}

async function learnedFunctionNames(baseDir: string, tenant: string): Promise<string[]> {
  const dir = path.join(baseDir, "lib", tenant);
  try {
    const entries = await fsp.readdir(dir);
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue;
      const filePath = path.join(dir, entry);
      const source = await fsp.readFile(filePath, "utf8");
      if (source.includes("@shape-hash")) names.push(entry.slice(0, -3));
    }
    return names.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function learnedInputKind(baseDir: string, tenant: string, name: string): Promise<LearnedInputKind> {
  const filePath = path.join(baseDir, "lib", tenant, `${name}.ts`);
  try {
    const source = await fsp.readFile(filePath, "utf8");
    return source.includes("filter: Record<string, unknown>") || source.includes("filter: v.record")
      ? "filterLimit"
      : "queryOpts";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "queryOpts";
    throw error;
  }
}

function learnedInputType(kind: LearnedInputKind): string {
  if (kind === "filterLimit") {
    return "{ filter: Record<string, unknown>; limit: number; query: string; family: string; entities: string[]; analysis: string }";
  }
  return "{ query: string; opts?: { limit?: number }; family: string; entities: string[]; analysis: string }";
}

function learnedInvocationSnippet(kind: LearnedInputKind): string {
  return kind === "filterLimit"
    ? "{ filter: { family }, limit: 100, query, family, entities, analysis }"
    : "{ query, opts: { limit: 30 }, family, entities, analysis }";
}

function learnedInvocationExample(name: string, kind: LearnedInputKind): string {
  return [
    `const learnedResult = await df.lib.${name}(${learnedInvocationSnippet(kind)});`,
    "const answerPayload = learnedResult.value;",
    "return df.answer({ value: answerPayload.value, evidence: answerPayload.evidence, derivation: answerPayload.derivation, coverage: answerPayload.coverage });",
  ].join("\n");
}

async function refreshKnownLearnedFiles(baseDir: string, tenant: string): Promise<void> {
  const dir = path.join(baseDir, "lib", tenant);
  try {
    const entries = await fsp.readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue;
      const filePath = path.join(dir, entry);
      const source = await fsp.readFile(filePath, "utf8");
      if (source.includes("@shape-hash")) knownLearnedFiles.add(filePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function countOverlayFunctions(baseDir: string, tenant: string): Promise<number> {
  const dir = path.join(baseDir, "lib", tenant);
  try {
    const entries = await fsp.readdir(dir);
    await refreshKnownLearnedFiles(baseDir, tenant);
    return entries.filter((entry) => entry.endsWith(".ts")).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function writeSeedFunctions(baseDir: string, names: string[]): Promise<void> {
  const dir = path.join(baseDir, "lib", "__seed__");
  await fsp.mkdir(dir, { recursive: true });
  await Promise.all(
    names.map((name) => fsp.writeFile(path.join(dir, `${name}.ts`), renderSeedFunction(name), "utf8")),
  );
}

function renderSeedFunction(name: string): string {
  return `
import { fn } from "@datafetch/sdk";
import * as v from "valibot";

export const ${name} = fn({
  intent: "Summarize SkillCraft-shaped structured rows for repeated dataset-query evaluation.",
  examples: [],
  input: v.unknown(),
  output: v.unknown(),
  async body(input) {
    const request = input as any;
    const rows = Array.isArray(request.rows) ? request.rows : [];
    const entities = Array.isArray(request.entities) ? request.entities : [];
    const selected = rows.filter((row: any) => row.family === request.family && entities.includes(row.entity));
    const evidence = selected.map((row: any) => ({ ref: row.id, entity: row.entity, label: row.label }));
    const value = summarize(request.family, request.analysis, selected);
    return {
      value,
      evidence,
      coverage: { requested: entities.length, matched: selected.length },
      derivation: [
        { step: "filter", requested: entities, matched: selected.map((row: any) => row.entity) },
        { step: "compute", family: request.family, analysis: request.analysis },
      ],
    };
  },
});

function summarize(family: string, analysis: string, rows: any[]) {
  if (family === "economic") {
    if (analysis === "hard") {
      return {
        advancedEntities: rows
          .filter((row) => row.metrics.gdpPerCapita > 40000)
          .sort((a, b) => b.metrics.gdpPerCapita - a.metrics.gdpPerCapita)
          .map((row) => row.label),
        fastestGrowth: maxBy(rows, (row) => row.metrics.growth)?.label,
      };
    }
    return {
      count: rows.length,
      top: maxBy(rows, (row) => row.metrics.gdp)?.label,
      advanced: rows.filter((row) => row.metrics.gdpPerCapita > 40000).length,
    };
  }
  if (family === "blog") {
    if (analysis === "hard") {
      return {
        commentDensityLeader: maxBy(rows, (row) => row.metrics.comments / row.metrics.posts)?.label,
        totalLikes: sum(rows, "likes"),
      };
    }
    return { count: rows.length, totalPosts: sum(rows, "posts"), top: maxBy(rows, (row) => row.metrics.likes)?.label };
  }
  if (family === "country") {
    if (analysis === "hard") {
      return {
        landlocked: rows.filter((row) => Boolean(row.attributes.landlocked)).length,
        totalBorders: sum(rows, "borders"),
      };
    }
    return {
      count: rows.length,
      largest: maxBy(rows, (row) => row.metrics.population)?.label,
      totalPopulation: sum(rows, "population"),
    };
  }
  if (family === "profile") {
    if (analysis === "hard") {
      return {
        highestScore: maxBy(rows, (row) => row.metrics.score)?.label,
        averagePurchases: round(avg(rows, "purchases"), 0),
      };
    }
    return {
      count: rows.length,
      averageAge: round(avg(rows, "age"), 0),
      femaleCount: rows.filter((row) => row.attributes.gender === "female").length,
    };
  }
  if (family === "university") {
    if (analysis === "hard") {
      return {
        oldest: minBy(rows, (row) => row.metrics.founded)?.label,
        medianRank: median(rows.map((row) => row.metrics.rank)),
      };
    }
    return {
      count: rows.length,
      topRanked: minBy(rows, (row) => row.metrics.rank)?.label,
      totalStudents: sum(rows, "students"),
    };
  }
  if (family === "weather") {
    if (analysis === "hard") {
      return {
        stormAlerts: rows.filter((row) => row.attributes.condition === "storm").length,
        strongestWind: maxBy(rows, (row) => row.metrics.wind)?.label,
      };
    }
    return {
      count: rows.length,
      highestRisk: maxBy(rows, weatherRisk)?.label,
      averageRain: round(avg(rows, "rain"), 1),
    };
  }
  return { count: rows.length };
}

function sum(rows: any[], key: string) {
  return rows.reduce((total, row) => total + Number(row.metrics[key] ?? 0), 0);
}

function avg(rows: any[], key: string) {
  if (rows.length === 0) return 0;
  return sum(rows, key) / rows.length;
}

function round(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? round((sorted[mid - 1] + sorted[mid]) / 2, 0) : sorted[mid];
}

function maxBy(rows: any[], score: (row: any) => number) {
  return rows.reduce((best, row) => (best === undefined || score(row) > score(best) ? row : best), undefined);
}

function minBy(rows: any[], score: (row: any) => number) {
  return rows.reduce((best, row) => (best === undefined || score(row) < score(best) ? row : best), undefined);
}

function weatherRisk(row: any) {
  return row.metrics.rain * 4 + row.metrics.wind * 1.5 + Math.max(0, row.metrics.temp - 28) * 2;
}
`.trimStart();
}

function aggregate(episodes: EpisodeMetrics[]): AggregateMetrics {
  const count = episodes.length;
  if (count === 0) {
    return {
      count: 0,
      correctness: 0,
      evidenceRecall: 0,
      avgTokens: 0,
      avgEffectiveTokens: 0,
      avgCachedInputTokens: 0,
      avgUncachedInputTokens: 0,
      avgOutputTokens: 0,
      avgLatencyMs: 0,
      avgToolCalls: 0,
      avgCommandsRun: 0,
      avgWorkspaceBytesRead: 0,
      reuseRate: null,
      regressions: null,
    };
  }
  const reuseEpisodes = episodes.filter((episode) => episode.mode === "datafetch");
  return {
    count,
    correctness: avg(episodes.map((episode) => (episode.answerCorrect ? 1 : 0))),
    evidenceRecall: avg(episodes.map((episode) => episode.evidenceRecall)),
    avgTokens: avg(episodes.map((episode) => episode.totalTokens)),
    avgEffectiveTokens: avg(episodes.map((episode) => episode.effectiveTokens)),
    avgCachedInputTokens: avg(episodes.map((episode) => episode.agentCachedInputTokens ?? 0)),
    avgUncachedInputTokens: avg(episodes.map((episode) => episode.agentUncachedInputTokens ?? episode.effectiveTokens)),
    avgOutputTokens: avg(episodes.map((episode) => episode.agentOutputTokens ?? 0)),
    avgLatencyMs: avg(episodes.map((episode) => episode.elapsedMs)),
    avgToolCalls: avg(episodes.map((episode) => episode.toolCalls)),
    avgCommandsRun: avg(episodes.map((episode) => episode.agentCommandsRun ?? 0)),
    avgWorkspaceBytesRead: avg(episodes.map((episode) => episode.agentWorkspaceBytesRead ?? 0)),
    reuseRate: reuseEpisodes.length === 0 ? null : avg(reuseEpisodes.map((episode) => episode.reuseRate)),
    regressions: reuseEpisodes.length === 0 ? null : 1 - avg(reuseEpisodes.map((episode) => (episode.regressionsPassed ? 1 : 0))),
  };
}

function delta(base: AggregateMetrics, candidate: AggregateMetrics): DeltaMetrics {
  return {
    correctness: candidate.correctness - base.correctness,
    evidenceRecall: candidate.evidenceRecall - base.evidenceRecall,
    avgTokens: pctDelta(base.avgTokens, candidate.avgTokens),
    avgEffectiveTokens: pctDelta(base.avgEffectiveTokens, candidate.avgEffectiveTokens),
    avgLatencyMs: pctDelta(base.avgLatencyMs, candidate.avgLatencyMs),
    avgToolCalls: pctDelta(base.avgToolCalls, candidate.avgToolCalls),
    avgCommandsRun: pctDelta(base.avgCommandsRun, candidate.avgCommandsRun),
    avgWorkspaceBytesRead: pctDelta(base.avgWorkspaceBytesRead, candidate.avgWorkspaceBytesRead),
  };
}

function pctDelta(base: number, candidate: number): number {
  if (base === 0) return candidate === 0 ? 0 : 1;
  return (candidate - base) / base;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function diagnose(
  comparison: SkillcraftEvalReport["comparison"],
  warmEpisodes: EpisodeMetrics[],
  hardEpisodes: EpisodeMetrics[],
  breakdowns: FamilyBreakdown[],
  driver: EvalDriver,
): string[] {
  const diagnostics: string[] = [];
  if ((comparison.datafetchWarm.reuseRate ?? 0) <= 0.5) {
    diagnostics.push("Agent discovery/reuse is weak: Round 2 reuse rate did not clear 0.5. Inspect apropos/man ranking and learned function naming.");
  }
  if (comparison.datafetchWarm.correctness < comparison.datafetchCold.correctness) {
    diagnostics.push("Warm correctness regressed below cold correctness. Check whether learned interfaces over-fit the cold entities.");
  }
  if (comparison.warmVsBaseline.avgTokens >= -0.5) {
    diagnostics.push("Warm raw-token reduction is below the 50% target. Inspect cached-token noise before treating raw input tokens as cost.");
  }
  if (comparison.warmVsBaseline.avgEffectiveTokens >= -0.5) {
    diagnostics.push("Warm effective-token reduction is below the 50% target. The agent may still be reading too much workspace context before calling the learned interface.");
  }
  if (comparison.warmVsBaseline.avgLatencyMs >= -0.4) {
    diagnostics.push(
      driver === "codex-live"
        ? "Warm latency reduction is below the 60% target under the live Codex driver."
        : "Warm latency reduction is below the 60% target. In deterministic mode, latency is an agent-work estimate, not a live LLM wall-clock measurement.",
    );
  }
  if (avg(hardEpisodes.map((episode) => (episode.answerCorrect ? 1 : 0))) < 0.7) {
    diagnostics.push("Hard-round generalization is below target. Distilled interfaces are too narrow or the task variants need a richer reusable parameter shape.");
  }
  if ((comparison.datafetchWarm.regressions ?? 0) > 0.05) {
    diagnostics.push("Regression rate exceeded 5%. Replay coverage or lib mutation rules need tightening.");
  }
  for (const breakdown of breakdowns) {
    if (breakdown.warm.libFunctionsUsed === 0) {
      diagnostics.push(`${breakdown.family}: warm task did not use a learned df.lib.* function.`);
    }
  }
  if (diagnostics.length === 0) {
    diagnostics.push(
      driver === "codex-live"
        ? "Live e2e criteria passed on correctness, reuse, measured token usage, measured wall-clock latency, and replay stability."
        : "Local e2e criteria passed on correctness, reuse, token estimate, and replay stability. Replace deterministic source generation with the live agent driver for final cost/latency claims.",
    );
  }
  void warmEpisodes;
  return diagnostics;
}

function renderMarkdownReport(report: SkillcraftEvalReport): string {
  const isLive = report.execution.driver === "codex-live";
  const intro = isLive
    ? "This live e2e run adapts SkillCraft task families into a datafetch harness and uses Codex as the task-solving agent. Baseline runs are stateless and use the same mounted dataset without df.lib helpers. Datafetch runs keep a persistent tenant lib so the observer can promote a learned interface after the cold round, then replay every family episode after lib evolution."
    : "This local e2e run adapts six SkillCraft task families into a datafetch harness. Baseline runs are stateless and use df.db rows plus local computation without seed helpers. Datafetch runs keep a persistent tenant lib so the observer can promote a learned interface after the cold round, then replay every family episode after lib evolution.";
	  const notes = isLive
	    ? [
	        "- `elapsedMs` includes live Codex agent wall-clock time plus Datafetch runtime replay time.",
	        "- `Avg Raw Tokens` is parsed from Codex JSONL usage (`input_tokens + output_tokens`). `Avg Effective Tokens` is `(input_tokens - cached_input_tokens) + output_tokens`.",
	        "- `toolCalls` counts client-visible `df.db.*` calls. `substrateDbCalls` is retained in `results.json` for nested learned-interface execution.",
	        report.execution.warmFastPath
	          ? "- Warm/hard Datafetch episodes first try a validated learned-interface scaffold with no agent call; failed scaffold attempts fall back to the live Codex driver."
	          : "- Warm/hard Datafetch episodes are solved by the live Codex driver unless deterministic mode is selected.",
	        "- Each episode artifact directory contains the runtime `commit.ts`, `answer.json`, `validation.json`, `lineage.json`, copied `source.ts`, agent prompt/events/usage, and `task.json` when those files are emitted by the snippet runtime.",
	      ]
    : [
        "- `elapsedMs` is an agent-work estimate over real runtime elapsed time, source size, and client-visible calls. It is not a live LLM wall-clock measurement.",
        "- `toolCalls` counts client-visible `df.db.*` calls. `substrateDbCalls` is retained in `results.json` for nested learned-interface execution.",
        "- `totalTokens` is a deterministic source-and-answer token proxy until the live agent driver is wired in.",
        "- Each episode artifact directory contains the runtime `commit.ts`, `answer.json`, `validation.json`, `lineage.json`, copied `source.ts`, and `task.json` when those files are emitted by the snippet runtime.",
      ];
  const rows = [
    ["Correctness", pct(report.comparison.baseline.correctness), pct(report.comparison.datafetchCold.correctness), pct(report.comparison.datafetchWarm.correctness), signedPct(report.comparison.warmVsBaseline.correctness)],
    ["Evidence Recall", pct(report.comparison.baseline.evidenceRecall), pct(report.comparison.datafetchCold.evidenceRecall), pct(report.comparison.datafetchWarm.evidenceRecall), signedPct(report.comparison.warmVsBaseline.evidenceRecall)],
    ["Avg Raw Tokens", int(report.comparison.baseline.avgTokens), int(report.comparison.datafetchCold.avgTokens), int(report.comparison.datafetchWarm.avgTokens), signedPct(report.comparison.warmVsBaseline.avgTokens)],
    ["Avg Effective Tokens", int(report.comparison.baseline.avgEffectiveTokens), int(report.comparison.datafetchCold.avgEffectiveTokens), int(report.comparison.datafetchWarm.avgEffectiveTokens), signedPct(report.comparison.warmVsBaseline.avgEffectiveTokens)],
    ["Avg Cached Input Tokens", int(report.comparison.baseline.avgCachedInputTokens), int(report.comparison.datafetchCold.avgCachedInputTokens), int(report.comparison.datafetchWarm.avgCachedInputTokens), "-"],
    ["Avg Latency (ms)", int(report.comparison.baseline.avgLatencyMs), int(report.comparison.datafetchCold.avgLatencyMs), int(report.comparison.datafetchWarm.avgLatencyMs), signedPct(report.comparison.warmVsBaseline.avgLatencyMs)],
    ["Avg Tool Calls", fixed(report.comparison.baseline.avgToolCalls), fixed(report.comparison.datafetchCold.avgToolCalls), fixed(report.comparison.datafetchWarm.avgToolCalls), signedPct(report.comparison.warmVsBaseline.avgToolCalls)],
    ["Avg Agent Commands", fixed(report.comparison.baseline.avgCommandsRun), fixed(report.comparison.datafetchCold.avgCommandsRun), fixed(report.comparison.datafetchWarm.avgCommandsRun), signedPct(report.comparison.warmVsBaseline.avgCommandsRun)],
    ["Avg Workspace Bytes Read", int(report.comparison.baseline.avgWorkspaceBytesRead), int(report.comparison.datafetchCold.avgWorkspaceBytesRead), int(report.comparison.datafetchWarm.avgWorkspaceBytesRead), signedPct(report.comparison.warmVsBaseline.avgWorkspaceBytesRead)],
    ["Reuse Rate", "N/A", pct(report.comparison.datafetchCold.reuseRate ?? 0), pct(report.comparison.datafetchWarm.reuseRate ?? 0), "-"],
    ["Regressions", "N/A", "N/A", pct(report.comparison.datafetchWarm.regressions ?? 0), "-"],
  ];

  const familyRows = report.perFamily.map((family) => [
    family.family,
    family.learnedFunction ?? "none",
    pct(family.cold.answerCorrect ? 1 : 0),
    `${pct(family.warm.answerCorrect ? 1 : 0)} / reuse ${pct(family.warm.reuseRate)}`,
    `${pct(family.hard.answerCorrect ? 1 : 0)} / reuse ${pct(family.hard.reuseRate)}`,
  ]);
  const warmBehaviorRows = report.perFamily.map((family) => [
    family.family,
    family.warm.agentSelectedInterface ?? "none",
    String(family.warm.agentCommandsRun ?? 0),
    String(family.warm.agentWorkspaceFilesRead ?? 0),
    int(family.warm.agentWorkspaceBytesRead ?? 0),
    family.warm.agentWroteDbCall ? "yes" : "no",
    family.warm.agentReadSampleData ? "yes" : "no",
  ]);

  return [
    "# Datafetch x SkillCraft End-to-End Evaluation",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    intro,
    "",
    "## Comparison",
    "",
    table(["Metric", "Baseline", "Datafetch-Cold", "Datafetch-Warm", "Delta Warm vs Baseline"], rows),
    "",
    "## Per-Family Learning Curve",
    "",
    table(["Family", "Learned Function", "Cold", "Warm", "Hard"], familyRows),
    "",
    "## Warm Agent Behavior",
    "",
    table(["Family", "Selected Interface", "Commands", "Files Read", "Bytes Read", "Client DB Call", "Read Sample"], warmBehaviorRows),
    "",
    "## Diagnostics",
    "",
    ...report.diagnostics.map((item) => `- ${item}`),
    "",
    "## Notes",
    "",
    ...notes,
    "",
  ].join("\n");
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signedPct(value: number): string {
  const rounded = Math.round(value * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function int(value: number): string {
  return `${Math.round(value)}`;
}

function fixed(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  const report = await runSkillcraftDatafetchEval(parseCliArgs(process.argv.slice(2)));
  process.stdout.write(renderMarkdownReport(report));
  process.stdout.write(`\nArtifacts: ${report.artifactDir}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
