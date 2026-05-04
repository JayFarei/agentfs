import { closeAtlasClient } from "./datafetch/db/client.js";
import { createObserverRuntime } from "./datafetch/db/finqa_observe.js";
import { createTaskAgentRuntime } from "./datafetch/db/finqa_agent.js";
import { createOutlookAgentRuntime } from "./datafetch/db/finqa_outlook.js";
import { loadAllFinqaToAtlas, loadFinqaToAtlas } from "./loader/loadFinqaToAtlas.js";
import { getAtlasSearchStatus, setupAtlasSearch } from "./loader/setupAtlasSearch.js";
import { runLiveDemo } from "./demo.js";
import { endorseTrajectory, loadLocalDemoCases, reviewDraft, runQuery } from "./runner.js";
import { atlasfsHome } from "./trajectory/recorder.js";
import { planAtlasHydration } from "./workspace/atlasAdapter.js";
import {
  budgetWorkspaceProcedure,
  checkWorkspaceDrift,
  evalWorkspace,
  hasWorkspace,
  initWorkspace,
  reviewWorkspaceDraft,
  runWorkspaceQuery
} from "./workspace/runtime.js";

function parseFlags(argv: string[]): { positionals: string[]; flags: Record<string, string | boolean | string[]> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  const booleanFlags = new Set(["all", "dry-run", "local", "no-wait", "reset", "skip-atlas-check", "yes"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (booleanFlags.has(key)) {
      addFlag(flags, key, true);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      addFlag(flags, key, true);
    } else {
      addFlag(flags, key, next);
      index += 1;
    }
  }
  return { positionals, flags };
}

function addFlag(flags: Record<string, string | boolean | string[]>, key: string, value: string | boolean): void {
  const previous = flags[key];
  if (previous === undefined) {
    flags[key] = value;
  } else if (Array.isArray(previous)) {
    previous.push(String(value));
  } else {
    flags[key] = [String(previous), String(value)];
  }
}

function flagString(flags: Record<string, string | boolean | string[]>, key: string): string | undefined {
  const value = flags[key];
  if (Array.isArray(value)) {
    return value.at(-1);
  }
  return typeof value === "string" ? value : undefined;
}

function flagStrings(flags: Record<string, string | boolean | string[]>, key: string): string[] {
  const value = flags[key];
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === "string" ? [value] : [];
}

function flagNumber(flags: Record<string, string | boolean | string[]>, key: string): number | undefined {
  const value = flagString(flags, key);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${key} must be a number`);
  }
  return parsed;
}

function usage(): void {
  console.log(`atlasfs local proof loop

Commands:
  pnpm atlasfs init [--fixture all]
  pnpm atlasfs load-finqa [--all] [--dataset dev] [--limit 100] [--filename V/2008/page_17.pdf] [--reset]
  pnpm atlasfs setup-search [--no-wait]
  pnpm atlasfs atlas-status
  pnpm atlasfs demo [--project ./demo-project] [--reset] [--tenant financial-analyst]
  pnpm atlasfs run "question" [--tenant financial-analyst] [--local] [--observer fixture|anthropic|flue] [--task-agent fixture|flue] [--outlook-agent fixture|flue]
  pnpm atlasfs review <draft-id> --confirm "guidance"
  pnpm atlasfs review <draft-id> --specify "extra requirement" [--local]
  pnpm atlasfs review <draft-id> --yes [--local] [--observer flue|anthropic|fixture]
  pnpm atlasfs review <draft-id> --refuse "reason"
  pnpm atlasfs endorse <trajectory-id-or-path>
  pnpm atlasfs budget <procedure> [--tenant data-analyst]
  pnpm atlasfs drift check
  pnpm atlasfs eval --round 0 --tenant data-analyst --tenant support-analyst
  pnpm atlasfs hydrate-atlas --dry-run [--db atlasfs_hackathon]

Environment for Atlas:
  MONGODB_URI      MongoDB Atlas connection string for the Sandbox Project
  ATLAS_DB_NAME    Database name, defaults to atlasfs_hackathon

Live demo:
  Uses MongoDB Atlas plus live Flue agents by default. It refuses fixture fallback.
  Requires ANTHROPIC_API_KEY or ANTHROPIC_KEY.
`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseFlags(rest);

  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }

  if (command === "init") {
    const fixture = flagString(flags, "fixture") ?? "all";
    if (fixture !== "all") {
      throw new Error("Only --fixture all is supported for the local filesystem runtime");
    }
    const manifest = await initWorkspace({ baseDir: atlasfsHome(), fixture: "all" });
    console.log(
      `initialized ${atlasfsHome()} with ${manifest.datasets.length} fixture datasets and ${manifest.tenants.length} tenants`
    );
    return;
  }

  if (command === "load-finqa") {
    if (flags.all) {
      const result = await loadAllFinqaToAtlas({
        reset: Boolean(flags.reset)
      });
      console.log(
        `loaded ${result.cases} records and ${result.searchUnits} search units into ${result.dbName}`
      );
      console.log(
        `collection counts: ${result.collectionCounts.cases} cases, ${result.collectionCounts.searchUnits} search units`
      );
      return;
    }

    const result = await loadFinqaToAtlas({
      dataset: (flagString(flags, "dataset") as "dev" | "train" | "test" | "private_test" | undefined) ?? "dev",
      limit: flagNumber(flags, "limit"),
      filename: flagString(flags, "filename"),
      reset: Boolean(flags.reset)
    });
    console.log(`loaded ${result.cases} cases and ${result.searchUnits} search units into ${result.dbName}`);
    return;
  }

  if (command === "setup-search") {
    const result = await setupAtlasSearch({
      wait: !flags["no-wait"],
      timeoutMs: flagNumber(flags, "timeout-ms")
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "atlas-status") {
    const result = await getAtlasSearchStatus();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "demo") {
    const observer = flagString(flags, "observer") ?? "flue";
    const outlookAgent = flagString(flags, "outlook-agent") ?? "flue";
    if (observer !== "flue" && observer !== "anthropic") {
      throw new Error("Live demo observer must be --observer flue or --observer anthropic; fixture is not allowed.");
    }
    if (outlookAgent !== "flue") {
      throw new Error("Live demo outlook agent must be --outlook-agent flue; fixture is not allowed.");
    }
    await runLiveDemo({
      projectDir: flagString(flags, "project") ?? "atlasfs-live-demo",
      tenantId: flagString(flags, "tenant") ?? "financial-analyst",
      reset: Boolean(flags.reset),
      observer,
      outlookAgent,
      skipAtlasCheck: Boolean(flags["skip-atlas-check"])
    });
    return;
  }

  if (command === "run") {
    const question = positionals.join(" ").trim();
    if (!question) {
      throw new Error('Usage: pnpm atlasfs run "question"');
    }
    const tenantId = flagString(flags, "tenant") ?? "financial-analyst";
    if (flags.local && (await hasWorkspace(atlasfsHome()))) {
      const result = await runWorkspaceQuery({
        question,
        tenantId,
        baseDir: atlasfsHome()
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const backend = flags.local
      ? { kind: "local" as const, cases: await loadLocalDemoCases() }
      : { kind: "atlas" as const };
    const observer = flagString(flags, "observer");
    const taskAgent = flagString(flags, "task-agent");
    const outlookAgent = flagString(flags, "outlook-agent");
    const result = await runQuery({
      question,
      tenantId,
      backend,
      observerRuntime: observer ? createObserverRuntime(observer) : undefined,
      taskAgentRuntime: taskAgent ? createTaskAgentRuntime(taskAgent) : undefined,
      outlookAgentRuntime: outlookAgent ? createOutlookAgentRuntime(outlookAgent) : undefined
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "endorse") {
    const trajectoryIdOrPath = positionals[0];
    if (!trajectoryIdOrPath) {
      throw new Error("Usage: pnpm atlasfs endorse <trajectory-id-or-path>");
    }
    const result = await endorseTrajectory({ trajectoryIdOrPath });
    console.log(`wrote ${result.jsonPath}`);
    console.log(`wrote ${result.tsPath}`);
    return;
  }

  if (command === "review") {
    const draftIdOrPath = positionals[0];
    if (!draftIdOrPath) {
      throw new Error("Usage: pnpm atlasfs review <draft-id> --confirm|--specify|--yes|--refuse");
    }
    const requested = [
      flags.confirm ? "confirm" : null,
      flags.specify ? "specify" : null,
      flags.yes ? "yes" : null,
      flags.refuse ? "refuse" : null
    ].filter(Boolean) as Array<"confirm" | "specify" | "yes" | "refuse">;
    if (requested.length !== 1) {
      throw new Error("Review requires exactly one action: --confirm, --specify, --yes, or --refuse");
    }
    if (flags.local && requested[0] === "yes" && (await hasWorkspace(atlasfsHome()))) {
      const result = await reviewWorkspaceDraft({
        draftIdOrPath,
        tenantId: flagString(flags, "tenant"),
        baseDir: atlasfsHome()
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const action = requested[0];
    const message =
      action === "confirm"
        ? flagString(flags, "confirm")
        : action === "specify"
          ? flagString(flags, "specify")
          : action === "refuse"
            ? flagString(flags, "refuse")
            : undefined;
    const needsBackend = action === "specify" || action === "yes";
    const backend = needsBackend
      ? flags.local
        ? { kind: "local" as const, cases: await loadLocalDemoCases() }
        : { kind: "atlas" as const }
      : undefined;
    const observer = action === "yes" ? flagString(flags, "observer") ?? "flue" : undefined;
    const result = await reviewDraft({
      draftIdOrPath,
      action,
      message,
      backend,
      observerRuntime: observer ? createObserverRuntime(observer) : undefined
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "budget") {
    const procedureName = positionals[0];
    if (!procedureName) {
      throw new Error("Usage: pnpm atlasfs budget <procedure> [--tenant data-analyst]");
    }
    const result = await budgetWorkspaceProcedure({
      procedureName,
      tenantId: flagString(flags, "tenant") ?? "data-analyst",
      baseDir: atlasfsHome()
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "drift") {
    if (positionals[0] !== "check") {
      throw new Error("Usage: pnpm atlasfs drift check");
    }
    const result = await checkWorkspaceDrift(atlasfsHome());
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "eval") {
    const tenants = flagStrings(flags, "tenant");
    const result = await evalWorkspace({
      round: flagNumber(flags, "round") ?? 0,
      tenants: tenants.length > 0 ? tenants : ["data-analyst", "support-analyst"],
      baseDir: atlasfsHome()
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "hydrate-atlas") {
    if (!flags["dry-run"]) {
      throw new Error("hydrate-atlas currently supports --dry-run only for the local acceptance path");
    }
    const plan = await planAtlasHydration({
      baseDir: atlasfsHome(),
      dbName: flagString(flags, "db")
    });
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAtlasClient();
  });
