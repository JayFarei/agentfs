import type { ApiDataCollection, ApiClusterStatus, ApiEvalMetric, StateResponse } from "@server/types";
import { CenterEmpty } from "./CenterEmpty";
import { RunView } from "./RunView";
import type { RunState } from "./RunView";
import type { ProcEntry } from "./ProcPanel";

function MongoLeaf() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.2c-.4 0 -.6 .3 -.7 .6 c-2.2 4 -5.6 6.5 -5.6 11.6 c0 3 1.6 5.5 4 6.6 c.5 .2 1 .6 1 1.5 l.4 .9 c.1 .2 .3 .4 .5 .4 s.4 -.2 .5 -.4 l.4 -.9 c.1 -.9 .5 -1.3 1 -1.5 c2.4 -1.1 4 -3.6 4 -6.6 c0 -5.1 -3.4 -7.6 -5.6 -11.6 c-.1 -.3 -.3 -.6 -.7 -.6 z m.05 4 c.05 0 .1 .05 .1 .15 l.1 11.6 c0 .15 -.1 .25 -.25 .25 s-.25 -.1 -.25 -.25 l.1 -11.6 c0 -.1 .05 -.15 .15 -.15 z" />
    </svg>
  );
}

interface DataPanelProps {
  userName: string;
  tenant: string;
  data: ApiDataCollection[];
  cluster: ApiClusterStatus | null;
  run: RunState | null;
  procedures: ProcEntry[];
  drift: NonNullable<StateResponse["drift"]>;
  evalMetrics: ApiEvalMetric[];
  onEndorse: (trajectoryId: string) => void;
}

export function DataPanel({
  userName,
  tenant,
  data,
  cluster,
  run,
  procedures,
  drift,
  evalMetrics,
  onEndorse,
}: DataPanelProps) {
  const clusterName = cluster?.name ?? "atlas-prod-eu";
  const region = cluster?.region ?? "eu-west-1";
  const tier = cluster?.tier ?? "M40 · 3-node replica set";
  const baselines = [...new Set(evalMetrics.map((metric) => metric.baseline))];
  const latestAtlasfs = [...evalMetrics].reverse().find((metric) => metric.baseline === "atlasfs");

  return (
    <main
      className="v01-panel v01-panel--data"
      style={{ background: "var(--bg)", borderRight: "1px solid var(--border)" }}
    >
      {run ? (
        <RunView run={run} procedures={procedures} onEndorse={onEndorse} />
      ) : (
        <CenterEmpty userName={userName} tenant={tenant} />
      )}
      <div className="v01-panel__spacer" />
      <div className="v01-panel__sec v01-panel__sec--foot">
        <div className="v01-panel__hd">
          <span>cluster · {clusterName}</span>
          <span className="count">{data.length} collections</span>
        </div>
        <div className="v01-cluster-meta">
          <span>region · {region}</span>
          <span className="dot">·</span>
          <span>tier · {tier}</span>
          <span className="dot">·</span>
          <span className="ok">● connected</span>
        </div>
        <ul className="v01-coll">
          {data.map((d) => (
            <li key={d.name} className="v01-coll__row">
              <span className="v01-coll__icon" aria-hidden="true">
                <MongoLeaf />
              </span>
              <span className="v01-coll__name">{d.name}</span>
              <span className="v01-coll__docs">
                <b>{d.docs}</b> docs
              </span>
              <span className="v01-coll__kind">{d.kind}</span>
            </li>
          ))}
        </ul>
        {(drift.length > 0 || evalMetrics.length > 0) && (
          <div className="v01-cluster-meta" style={{ marginTop: 10, alignItems: "flex-start" }}>
            {drift.length > 0 && (
              <span>
                drift ·{" "}
                {drift.map((item) => `${item.name}:${item.drift}`).join(", ")}
              </span>
            )}
            {drift.length > 0 && evalMetrics.length > 0 && <span className="dot">·</span>}
            {evalMetrics.length > 0 && (
              <span>
                eval · {baselines.join("/")} · L_n {latestAtlasfs?.L_n.toFixed(2) ?? "0.00"}
              </span>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
