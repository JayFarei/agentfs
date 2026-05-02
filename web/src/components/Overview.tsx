import { useEffect, useState } from "react";
import type { ApiClusterStatus } from "@server/types";

interface UserEntry {
  name: string;
  role: string;
  tenant: string;
  procedures: { name: string }[];
  primitives: { name: string }[];
  data: { name: string }[];
}

interface OverviewProps {
  alice: UserEntry | null;
  bob: UserEntry | null;
  cluster: ApiClusterStatus | null;
  setActive: (v: "alice" | "bob") => void;
}

const COLLECTION_DESCRIPTIONS: Record<string, string> = {
  finqa_cases:
    "Normalized 10-K filings — pre-text, normalized table, post-text — for revenue/segment math and citation.",
  finqa_search_units:
    "Sentence-and-quote chunks of every filing, indexed for Atlas Search lex + vector retrieval.",
};

function DatasetModal({
  cluster,
  onClose,
}: {
  cluster: ApiClusterStatus | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const collections = cluster?.collections ?? [];
  const indexes = cluster?.searchIndexes ?? [];
  return (
    <div className="v01-cv__scrim" onClick={onClose}>
      <div className="v01-how" onClick={(e) => e.stopPropagation()}>
        <div className="v01-cv__hd">
          <div className="v01-cv__path">
            <span className="v01-cv__path-dim">atlasfs/</span>
            <span>dataset.md</span>
          </div>
          <div className="v01-cv__meta">
            <span>{cluster?.dbName ?? "atlasfs"}</span>
            <span>·</span>
            <span>{cluster?.backend ?? "atlas"}</span>
          </div>
          <button className="v01-cv__x" onClick={onClose}>
            esc
          </button>
        </div>
        <div className="v01-how__body">
          <div className="v01-how__hero">
            <div className="v01-how__l">DATASET · FINQA OVER 10-K FILINGS</div>
            <h1 className="v01-how__title">
              The data both agents read from.
            </h1>
            <p className="v01-how__lede">
              FinQA is a finance-QA benchmark of public-company 10-K filings
              paired with structured tables. We've loaded the corpus into
              MongoDB Atlas as two collections, indexed for hybrid lex + vector
              retrieval. Both agents read the same data; their chain libraries
              diverge based on the questions they ask.
            </p>
          </div>

          <div className="v01-overview__dataset-grid">
            {collections.map((c) => (
              <div key={c.name} className="v01-overview__dataset-card">
                <div className="v01-overview__dataset-name">{c.name}</div>
                <div className="v01-overview__dataset-count">
                  <span className="num">{c.docs}</span>
                  <span className="unit">{c.kind}</span>
                </div>
                <p className="v01-overview__dataset-desc">
                  {COLLECTION_DESCRIPTIONS[c.name] ?? "Atlas collection"}
                </p>
              </div>
            ))}
          </div>

          {indexes.length > 0 && (
            <div className="v01-overview__dataset-idx">
              <span className="l">SEARCH INDEXES</span>
              {indexes.map((idx) => (
                <span
                  key={`${idx.collection}.${idx.name}`}
                  className="v01-overview__dataset-idx-item"
                >
                  <code>
                    {idx.collection}.{idx.name}
                  </code>
                  <span className={idx.queryable ? "ok" : "bad"}>
                    {idx.queryable ? "● queryable" : `● ${idx.status}`}
                  </span>
                </span>
              ))}
            </div>
          )}

          <div className="v01-how__close">
            <p>
              Cluster · <code>{cluster?.name ?? "atlas-prod-eu"}</code> ·{" "}
              {cluster?.tier ?? "M40 · 3-node"} · {cluster?.region ?? "eu-west-1"}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function useDatasetModal(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  return [open, () => setOpen(true), () => setOpen(false)];
}

function AgentCard({
  k,
  user,
  onClick,
}: {
  k: "alice" | "bob";
  user: UserEntry;
  onClick: () => void;
}) {
  return (
    <button className="v01-topo__agent" data-who={k} onClick={onClick}>
      <div className="v01-topo__agent-hd">
        <span className="avatar" data-who={k}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <circle cx="8" cy="6" r="2.6" />
            <path
              d="M3 14 c0.4 -2.8 2.6 -4.2 5 -4.2 c2.4 0 4.6 1.4 5 4.2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div>
          <div className="v01-topo__agent-name">
            {user.name} <span className="tag">agent</span>
          </div>
          <div className="v01-topo__agent-role">{user.role}</div>
        </div>
      </div>
      <div className="v01-topo__agent-tenant">tenant · {user.tenant}</div>
      <div className="v01-topo__agent-stats">
        <div>
          <span className="l">CHAINS</span>
          <span className="v">{user.procedures.length}</span>
        </div>
        <div>
          <span className="l">PRIMITIVES</span>
          <span className="v">{user.primitives.length}</span>
        </div>
        <div>
          <span className="l">DATA</span>
          <span className="v">{user.data.length}</span>
        </div>
      </div>
      <pre className="v01-topo__agent-pre">
        {user.procedures
          .slice(0, 3)
          .map((p) => `⌁ ${p.name}`)
          .join("\n") || "⌁ (no chains yet)"}
      </pre>
      <div className="v01-topo__agent-cta">enter agent →</div>
    </button>
  );
}

export function Overview({ alice, bob, cluster, setActive }: OverviewProps) {
  const [datasetOpen, openDataset, closeDataset] = useDatasetModal();
  const aliceEntry: UserEntry = alice ?? {
    name: "Alice",
    role: "Equity research analyst",
    tenant: "alice",
    procedures: [],
    primitives: [],
    data: [],
  };
  const bobEntry: UserEntry = bob ?? {
    name: "Bob",
    role: "Competitive intelligence analyst",
    tenant: "bob",
    procedures: [],
    primitives: [],
    data: [],
  };

  return (
    <div className="v01-center__scroll">
      <div className="v01-overview">
        <div className="v01-overview__hd">
          <span className="v01-overview__l">DEMO · BIRD'S-EYE</span>
          <h1 className="v01-overview__title">
            Two agents, one cluster, two emergent applications.
          </h1>
          <p className="v01-overview__lede">
            Atlas data is loaded once into a typed virtual filesystem. Each
            agent's chain library and primitive set grows as queries are
            exercised — the same MongoDB cluster underneath, different overlays
            on top. Pick an agent to drive their surface.
          </p>
        </div>

        <div className="v01-topo">
          <AgentCard k="alice" user={aliceEntry} onClick={() => setActive("alice")} />
          <AgentCard k="bob" user={bobEntry} onClick={() => setActive("bob")} />

          <div className="v01-topo__bus">
            <span className="v01-topo__bus-line v01-topo__bus-line--l"></span>
            <span className="v01-topo__bus-line v01-topo__bus-line--r"></span>
            <span className="v01-topo__bus-arm v01-topo__bus-arm--l"></span>
            <span className="v01-topo__bus-arm v01-topo__bus-arm--r"></span>
            <span className="v01-topo__bus-feed"></span>
            <div className="v01-topo__cluster">
              <span className="v01-topo__pulse"></span>
              <div>
                <div className="v01-topo__cluster-l">MONGODB ATLAS · SHARED</div>
                <div className="v01-topo__cluster-name">
                  {cluster?.name ?? "atlas-prod-eu"}
                </div>
                <div className="v01-topo__cluster-meta">
                  {cluster?.tier ?? "M40 · 3-node"} ·{" "}
                  {cluster?.region ?? "eu-west-1"}
                </div>
              </div>
              <button
                className="v01-topo__info"
                onClick={(e) => {
                  e.stopPropagation();
                  openDataset();
                }}
                title="About this dataset"
                aria-label="About this dataset"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                >
                  <circle cx="8" cy="8" r="6.2" />
                  <path d="M8 7.2 v3.6" strokeLinecap="round" />
                  <circle cx="8" cy="5.2" r="0.55" fill="currentColor" stroke="none" />
                </svg>
                <span>about the data</span>
              </button>
            </div>
          </div>
        </div>

        <div className="v01-overview__legend">
          <div>
            <div className="l">TYPED VFS</div>
            <p>
              One typed projection of the cluster, mounted at{" "}
              <code>data/</code>. Both agents read against the same shapes.
            </p>
          </div>
          <div>
            <div className="l">CHAINS</div>
            <p>
              Compiled, named affordances at{" "}
              <code>chains/&lt;tenant&gt;/</code>. Diverge per agent as each
              exercises their own questions.
            </p>
          </div>
          <div>
            <div className="l">PRIMITIVES</div>
            <p>
              Typed callables — deterministic at boot, plus Flue-spawned agents
              learned at runtime. The set grows when a question demands LLM
              judgement no t=0 primitive can provide.
            </p>
          </div>
        </div>
      </div>
      {datasetOpen && <DatasetModal cluster={cluster} onClose={closeDataset} />}
    </div>
  );
}
