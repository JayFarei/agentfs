import { promises as fsp } from "node:fs";
import path from "node:path";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  severity: "pass" | "warn" | "fail";
}

async function main(): Promise<void> {
  const root = path.resolve("eval/skillcraft");
  const checks: Check[] = [];
  for (const file of [
    "README.md",
    "protocol.md",
    "hypotheses.md",
    "runbook.md",
    "configs/arms.yaml",
    "configs/task-splits.yaml",
    "configs/models.example.json",
    "configs/metrics-schema.json",
    "adapters/skillcraft-fixture-contract.md",
    "adapters/tool-bridge-contract.md",
    "adapters/verifier-bridge-contract.md",
    "scripts/prepare-skillcraft.sh",
    "scripts/run-native-skillcraft.sh",
    "scripts/run-native-claw-codex.sh",
    "scripts/run-datafetch-skillcraft.sh",
    "scripts/check-native-readiness.ts",
    "scripts/index-skillcraft-tasks.ts",
    "scripts/normalize-results.ts",
    "scripts/analyze-results.ts",
    "scripts/build-report.ts",
    "scripts/invoke-skillcraft-tool.py",
  ]) {
    const ok = await exists(path.join(root, file));
    checks.push({ name: `file:${file}`, ok, detail: ok ? "present" : "missing", severity: ok ? "pass" : "fail" });
  }

  const taskIndexPath = path.join(root, "manifests", "task-index.json");
  if (await exists(taskIndexPath)) {
    const taskIndex = JSON.parse(await fsp.readFile(taskIndexPath, "utf8"));
    checks.push(exact("manifest task count", taskIndex.summary?.tasks, 126));
    checks.push(exact("manifest family count", taskIndex.summary?.families, 21));
    checks.push(exact("manifest evaluator count", taskIndex.tasks?.filter((task: any) => task.hasEvaluator).length, 126));
    const missingDocs = Number(taskIndex.summary?.missingTaskDocs ?? 0);
    checks.push({
      name: "manifest task docs",
      ok: missingDocs === 0,
      detail: missingDocs === 0 ? "all task docs present" : `${missingDocs} task docs missing; native SkillCraft may not run without upstream prompt assets or a compatibility step`,
      severity: missingDocs === 0 ? "pass" : "warn",
    });
  } else {
    checks.push({
      name: "manifest:task-index",
      ok: false,
      detail: "missing; run prepare-skillcraft.sh",
      severity: "fail",
    });
  }

  const schemaPath = path.join(root, "configs", "metrics-schema.json");
  try {
    JSON.parse(await fsp.readFile(schemaPath, "utf8"));
    checks.push({ name: "metrics schema JSON", ok: true, detail: "valid JSON", severity: "pass" });
  } catch (error) {
    checks.push({ name: "metrics schema JSON", ok: false, detail: String(error), severity: "fail" });
  }

  const datafetchAdapterPath = path.resolve("src/eval/skillcraftFullDatafetch.ts");
  const hasDatafetchAdapter = await exists(datafetchAdapterPath);
  const datafetchAdapterSource = hasDatafetchAdapter ? await fsp.readFile(datafetchAdapterPath, "utf8") : "";
  const adapterMarkedReady = datafetchAdapterSource.includes("FULL_SKILLCRAFT_DATAFETCH_ADAPTER_READY = true");
  checks.push({
    name: "datafetch full adapter",
    ok: hasDatafetchAdapter && adapterMarkedReady,
    detail: !hasDatafetchAdapter
      ? "missing; native arms are ready, but representative Datafetch-vs-SkillCraft results still require the adapter bridge"
      : adapterMarkedReady
        ? "implemented and marked ready"
        : "foundation present, but not marked ready for representative Datafetch-vs-SkillCraft results",
    severity: hasDatafetchAdapter && adapterMarkedReady ? "pass" : "warn",
  });

  for (const check of checks) {
    const label = check.severity === "pass" ? "PASS" : check.severity === "warn" ? "WARN" : "FAIL";
    console.log(`[${label}] ${check.name}: ${check.detail}`);
  }
  const failed = checks.filter((check) => check.severity === "fail");
  if (failed.length) {
    console.error(`${failed.length} harness verification checks failed.`);
    process.exit(1);
  }
}

function exact(name: string, actual: unknown, expected: number): Check {
  const ok = actual === expected;
  return {
    name,
    ok,
    detail: ok ? String(actual) : `expected ${expected}, got ${String(actual)}`,
    severity: ok ? "pass" : "fail",
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
