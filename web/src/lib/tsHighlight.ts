// Ported from App.v01.jsx — TypeScript syntax highlighter + signature builders

const KW = /\b(import|from|export|interface|const|async|await|return|as|keyof|Promise|function|type)\b/g;
const TY =
  /\b(string|number|boolean|void|unknown|any|Entity|FiscalYear|Money|Period|Guidance|CovenantStatus|MatchSet|RiskDiff|SegmentTable|PartyName|IncomeStatement|AuditTable|Trail|FiscalPeriod|Year|MetricKey|SegmentDim|AuditScope)\b/g;

export function tsHighlight(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return escaped
        .replace(
          /(\/\*[\s\S]*?\*\/|\/\/.*$)/g,
          (m) => `<span class=tk-cm>${m}</span>`
        )
        .replace(
          /("[^"]*"|'[^']*')/g,
          (m) => `<span class=tk-st>${m}</span>`
        )
        .replace(KW, (m) => `<span class=tk-kw>${m}</span>`)
        .replace(TY, (m) => `<span class=tk-ty>${m}</span>`);
    })
    .join("\n");
}

// Param-name to TS type inference for compact signatures.
export const TYPE_HINTS: Record<string, string> = {
  entity: "Entity",
  year: "FiscalYear",
  year_a: "FiscalYear",
  year_b: "FiscalYear",
  fiscal_period: "FiscalPeriod",
  period: "Period",
  segment_dim: "SegmentDim",
  metric: "MetricKey",
  party_name: "PartyName",
  scope: "AuditScope",
};

export function buildTsSignature(name: string, sig: string): string {
  const m = sig.match(/\(([^)]*)\)\s*[→>]\s*(.+)$/);
  if (!m) return `${name}${sig}`;
  const params = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ret = m[2].trim();
  const typedParams = params
    .map((p) => `${p}: ${TYPE_HINTS[p] ?? "any"}`)
    .join(", ");
  return `${name}(${typedParams}): ${ret}`;
}

export function buildIntentSignature(intent: {
  name: string;
  params: readonly string[];
}): string {
  const params = intent.params
    .map((p) => `${p}: ${TYPE_HINTS[p] ?? "any"}`)
    .join(", ");
  return `${intent.name}(${params}): unknown`;
}
