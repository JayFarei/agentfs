import { closeAtlasClient } from "./datafetch/db/client.js";
import { createObserverRuntime } from "./datafetch/db/finqa_observe.js";
import { createTaskAgentRuntime } from "./datafetch/db/finqa_agent.js";
import { createOutlookAgentRuntime } from "./datafetch/db/finqa_outlook.js";
import { loadFinqaToAtlas } from "./loader/loadFinqaToAtlas.js";
import { endorseTrajectory, loadLocalDemoCases, reviewDraft, runQuery } from "./runner.js";

function parseFlags(argv: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const booleanFlags = new Set(["local", "reset", "yes"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (booleanFlags.has(key)) {
      flags[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return { positionals, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function flagNumber(flags: Record<string, string | boolean>, key: string): number | undefined {
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
  pnpm atlasfs load-finqa [--dataset dev] [--limit 100] [--filename V/2008/page_17.pdf] [--reset]
  pnpm atlasfs run "question" [--tenant financial-analyst] [--local] [--observer fixture|anthropic|flue] [--task-agent fixture|flue] [--outlook-agent fixture|flue]
  pnpm atlasfs review <draft-id> --confirm "guidance"
  pnpm atlasfs review <draft-id> --specify "extra requirement" [--local]
  pnpm atlasfs review <draft-id> --yes [--local] [--observer flue|anthropic|fixture]
  pnpm atlasfs review <draft-id> --refuse "reason"
  pnpm atlasfs endorse <trajectory-id-or-path>

Environment for Atlas:
  MONGODB_URI      MongoDB Atlas connection string for the Sandbox Project
  ATLAS_DB_NAME    Database name, defaults to atlasfs_hackathon
`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseFlags(rest);

  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }

  if (command === "load-finqa") {
    const result = await loadFinqaToAtlas({
      dataset: (flagString(flags, "dataset") as "dev" | "train" | "test" | "private_test" | undefined) ?? "dev",
      limit: flagNumber(flags, "limit"),
      filename: flagString(flags, "filename"),
      reset: Boolean(flags.reset)
    });
    console.log(`loaded ${result.cases} cases and ${result.searchUnits} search units into ${result.dbName}`);
    return;
  }

  if (command === "run") {
    const question = positionals.join(" ").trim();
    if (!question) {
      throw new Error('Usage: pnpm atlasfs run "question"');
    }
    const tenantId = flagString(flags, "tenant") ?? "financial-analyst";
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
