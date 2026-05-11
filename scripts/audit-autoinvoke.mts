import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { buildAutoInvokeTrailer } from "../src/snippet/runtime.js";

const files = execSync(
  "find eval/skillcraft/results/datafetch/iter2-full-20260511-201102-g1 eval/skillcraft/results/datafetch/iter2-full-20260511-201102-g2 eval/skillcraft/results/datafetch/iter2-full-20260511-201102-g3 eval/skillcraft/results/datafetch/iter2-full-20260511-201102-g4 -name prepared-answer.ts",
).toString().trim().split("\n");

let total = 0;
let autoInvokeCases = 0;
const list: Array<{ task: string; names: string[] }> = [];
for (const f of files) {
  total += 1;
  const src = readFileSync(f, "utf8");
  const trailer = buildAutoInvokeTrailer(src);
  if (trailer) {
    const names = Array.from(trailer.matchAll(/await (\w+)\(\)/g)).map(
      (m) => m[1] as string,
    );
    autoInvokeCases += 1;
    const m = f.match(/episodes\/([^/]+)\/([^/]+)/);
    const task = m ? `${m[1]}/${m[2]}` : f;
    list.push({ task, names });
  }
}
console.log("total:", total, "autoInvoke cases:", autoInvokeCases);
list.forEach((x) => console.log(" -", x.task, x.names.join(",")));
