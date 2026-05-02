import type { ApiCall } from "@server/types";
import type { ProcEntry } from "./ProcPanel";

export interface RunState {
  query: string;
  procName: string | null;
  result: { title: string; answer: string; detail: string; cite: string; procedure: string } | null;
  mode: "novel" | "procedure" | null;
  trajectoryId?: string;
  endorsing: boolean;
  endorsed: boolean;
  // live execution detail
  inflight: boolean;
  done: boolean;
  calls: ApiCall[];
  callsRevealed: number;
  artifactsAdded: string[];
  errorMessage?: string;
}

interface RunViewProps {
  run: RunState;
  procedures: ProcEntry[];
  onEndorse: (trajectoryId: string) => void;
}

function tagFor(primitive: string): { label: string; cls: string } | null {
  if (primitive === "finqa_cases.findSimilar" || primitive === "finqa_cases.search" || primitive === "finqa_cases.hybrid") {
    return { label: "MongoDB Atlas Search", cls: "is-atlas" };
  }
  if (primitive === "finqa_table_math.execute" || primitive === "finqa_table_math.inferPlan") {
    return { label: "deterministic", cls: "is-local" };
  }
  if (primitive === "arithmetic.divide") {
    return { label: "pure", cls: "is-pure" };
  }
  if (primitive === "agent_store.save") {
    return { label: "new reusable agent", cls: "is-create" };
  }
  if (primitive === "procedure_store.save") {
    return { label: "new procedure", cls: "is-create" };
  }
  if (primitive === "agent_store.findReusable") {
    return { label: "reused agent", cls: "is-reuse" };
  }
  if (primitive.startsWith("procedures.")) {
    return { label: "stored procedure", cls: "is-stored" };
  }
  if (
    primitive.startsWith("finqa_outlook.") ||
    primitive.startsWith("finqa_observe.") ||
    primitive.startsWith("finqa_agent.")
  ) {
    return { label: "live agent", cls: "is-flue" };
  }
  if (primitive.startsWith("finqa_resolve.")) {
    return { label: "resolver", cls: "is-local" };
  }
  if (primitive.startsWith("document_units.")) {
    return { label: "local", cls: "is-local" };
  }
  return null;
}

export function RunView({ run, procedures, onEndorse }: RunViewProps) {
  const proc = procedures.find((p) => p.name === run.procName);
  const visible = run.calls.slice(0, run.callsRevealed);
  const total = run.calls.length;

  return (
    <div className="v01-run">
      <div className="v01-run__hd">
        <span className="v01-run__q">›  {run.query}</span>
        <div className="v01-run__mode">
          {run.mode === "procedure" ? (
            <>
              <span className="v01-run__mode-tag is-procedure">mode · procedure</span>
              <span className="v01-run__mode-meta">
                {total} call{total === 1 ? "" : "s"}
                {run.procName ? ` · via ${run.procName}` : ""}
              </span>
            </>
          ) : run.mode === "novel" ? (
            <>
              <span className="v01-run__mode-tag is-novel">mode · novel</span>
              <span className="v01-run__mode-meta">
                {run.inflight && total === 0
                  ? "executing primitive chain…"
                  : `${total} primitive call${total === 1 ? "" : "s"}`}
              </span>
            </>
          ) : run.inflight ? (
            <>
              <span className="v01-run__mode-tag is-pending">running…</span>
              <span className="v01-run__mode-meta">streaming primitive calls</span>
            </>
          ) : null}
          {proc && proc.sig && (
            <span className="v01-run__proc-sig">{proc.sig}</span>
          )}
        </div>
      </div>

      <div className="v01-run__calls">
        {run.inflight && total === 0 && (
          <div className="v01-run__call is-pending">
            <span className="v01-run__call-mark"><span className="spin">◐</span></span>
            <span className="v01-run__call-name">awaiting first primitive…</span>
          </div>
        )}
        {visible.map((call, i) => {
          const tag = tagFor(call.primitive);
          return (
            <div key={`${i}-${call.primitive}`} className="v01-run__call is-done">
              <span className="v01-run__call-mark">✓</span>
              <span className="v01-run__call-idx">{i + 1}.</span>
              <span className="v01-run__call-name">{call.primitive}</span>
              {tag && (
                <span className={`v01-run__call-tag ${tag.cls}`}>{tag.label}</span>
              )}
            </div>
          );
        })}
        {run.inflight && visible.length < total && (
          <div className="v01-run__call is-pending">
            <span className="v01-run__call-mark"><span className="spin">◐</span></span>
            <span className="v01-run__call-name">streaming…</span>
          </div>
        )}
      </div>

      {run.done && run.artifactsAdded.length > 0 && (
        <div className="v01-run__artifacts">
          <div className="v01-run__artifacts-l">artifacts added</div>
          <ul>
            {run.artifactsAdded.map((a) => (
              <li key={a}>+ {a}</li>
            ))}
          </ul>
        </div>
      )}
      {run.done && run.artifactsAdded.length === 0 && run.mode === "procedure" && (
        <div className="v01-run__artifacts is-empty">
          <div className="v01-run__artifacts-l">artifacts</div>
          <p>no new files · replayed from learned chain</p>
        </div>
      )}

      {run.done && run.result && (
        <div className="v01-run__result">
          <div className="v01-result__hd">
            <span className="v01-result__l">RESULT</span>
            <span className="v01-result__title">{run.result.title}</span>
          </div>
          <div className="v01-result__answer">{run.result.answer}</div>
          <div className="v01-result__detail">{run.result.detail}</div>
          <div className="v01-result__foot">
            <span>
              cited · <code>{run.result.cite}</code>
            </span>
            {run.mode === "novel" && run.trajectoryId && !run.endorsed && (
              <button
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: run.endorsing ? "var(--text-muted)" : "var(--info)",
                  padding: "3px 10px",
                  cursor: run.endorsing ? "default" : "pointer",
                  letterSpacing: "0.06em",
                }}
                disabled={run.endorsing}
                onClick={() =>
                  run.trajectoryId && onEndorse(run.trajectoryId)
                }
              >
                {run.endorsing ? "endorsing…" : "endorse this run"}
              </button>
            )}
            {run.endorsed && (
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--success)",
                  letterSpacing: "0.06em",
                }}
              >
                ✓ endorsed
              </span>
            )}
          </div>
        </div>
      )}

      {run.errorMessage && (
        <div className="v01-run__error">
          <strong>error</strong>
          <p>{run.errorMessage}</p>
        </div>
      )}
    </div>
  );
}
