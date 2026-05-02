import type {
  ApiDataCollection,
  ApiClusterStatus,
  ApiSuggestedQuestion,
  ApiPrimitive,
  ApiStoredAgent,
} from "@server/types";
import { ProcPanel } from "./ProcPanel";
import type { ProcEntry } from "./ProcPanel";
import { DataPanel } from "./DataPanel";
import { SystemPrimitivesPanel } from "./SystemPrimitivesPanel";
import type { RunState } from "./RunView";

interface IntentViewArg {
  name: string;
  desc: string;
  source?: string;
}

interface UserViewProps {
  name: string;
  role: string;
  tenant: string;
  pathLabel?: string;
  procedures: ProcEntry[];
  primitives: ApiPrimitive[];
  agents: ApiStoredAgent[];
  data: ApiDataCollection[];
  cluster: ApiClusterStatus | null;
  suggested: ApiSuggestedQuestion[];
  sourceMap: Record<string, string>;
  query: string;
  setQuery: (q: string) => void;
  submit: (q: string, procName?: string) => void;
  run: RunState | null;
  reset: () => void;
  startOver: () => void;
  openIntent: (i: IntentViewArg) => void;
  onEndorse: (trajectoryId: string) => void;
}

const NARRATION: Record<string, string> = {
  alice:
    "Path A · table-math. Intent 1 explores deterministically (5 calls) and crystallises a table_math procedure. Intent 2 replays the same shape on a sibling row in 1 call.",
  bob:
    "Path B · agent + glue. Intent 3 spins up a scorer agent and saves it alongside a sentence-glue procedure. Intent 4 reuses the agent with new glue. Intent 5 runs the whole thing as one procedure call.",
  "financial-analyst":
    "Path A · table-math. Run a novel question, endorse the trajectory, then replay the sibling intent through the saved procedure.",
};

export function UserView({
  name,
  role,
  tenant,
  pathLabel,
  procedures,
  primitives,
  agents,
  data,
  cluster,
  suggested,
  sourceMap,
  query,
  setQuery,
  submit,
  run,
  reset,
  startOver,
  openIntent,
  onEndorse,
}: UserViewProps) {
  return (
    <>
      <div className="v01-persona">
        <div className="v01-persona__row">
          <h1 className="v01-persona__name">{name}</h1>
          <span className="v01-persona__role">{role}</span>
          {pathLabel && (
            <span
              style={{
                marginLeft: 10,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
              }}
            >
              {pathLabel}
            </span>
          )}
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Reset ${name}'s tenant memory? This deletes ${tenant}'s procedures, agents, and trajectories.`
                )
              ) {
                startOver();
              }
            }}
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-muted)",
              background: "transparent",
              border: "1px solid var(--border)",
              padding: "4px 10px",
              cursor: "pointer",
            }}
            title="Wipe procedures, agents, drafts, and trajectories for this tenant"
          >
            [ start over ]
          </button>
        </div>
        {NARRATION[tenant] && (
          <p className="v01-persona__narr">{NARRATION[tenant]}</p>
        )}
      </div>
      <div className="v01-search">
        <div className="v01-search__bar">
          <span className="prompt">›</span>
          <input
            placeholder={`ask ${tenant} anything…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(query);
              }
            }}
          />
          <button onClick={() => submit(query)}>[run ↵]</button>
        </div>
        <div className="v01-search__sugg">
          <span className="label">DEMO INTENTS</span>
          {suggested.map((s) => {
            const provesIdx = s.hint?.toUpperCase().indexOf("PROVES:") ?? -1;
            const watchIdx = s.hint?.toUpperCase().indexOf("WATCH:") ?? -1;
            let provesText = "";
            let watchText = "";
            if (provesIdx >= 0 && watchIdx > provesIdx) {
              provesText = s.hint.slice(provesIdx + "PROVES:".length, watchIdx).trim().replace(/\.\s*$/, "");
              watchText = s.hint.slice(watchIdx + "WATCH:".length).trim();
            } else if (s.hint) {
              provesText = s.hint;
            }
            return (
              <button
                key={s.label}
                className="v01-search__chip"
                onClick={() => {
                  setQuery(s.question);
                  submit(s.question);
                }}
                title={s.question}
              >
                <span className="v01-search__chip-row">
                  <span className="glyph">⌁</span>
                  <span>{s.label}</span>
                </span>
                {provesText && (
                  <span className="v01-search__chip-proves">
                    <b>PROVES</b>
                    {provesText}
                  </span>
                )}
                {watchText && (
                  <span className="v01-search__chip-watch">
                    <b>WATCH</b>
                    {watchText}
                  </span>
                )}
              </button>
            );
          })}
          {run && (
            <button className="v01-search__clear" onClick={reset}>
              clear
            </button>
          )}
        </div>
      </div>
      <div
        className="v01-body"
        style={{ gridTemplateColumns: "280px 1fr 320px" }}
      >
        <ProcPanel
          tenant={tenant}
          procedures={procedures}
          sourceMap={sourceMap}
          openIntent={openIntent}
        />
        <DataPanel
          userName={name}
          tenant={tenant}
          data={data}
          cluster={cluster}
          run={run}
          procedures={procedures}
          onEndorse={onEndorse}
        />
        <SystemPrimitivesPanel
          primitives={primitives}
          agents={agents}
          openIntent={openIntent}
        />
      </div>
    </>
  );
}
