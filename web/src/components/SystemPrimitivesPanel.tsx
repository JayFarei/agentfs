import { useEffect, useRef, useState } from "react";
import type { ApiPrimitive, ApiStoredAgent, ApiLearnedFunction, ApiHook } from "@server/types";

interface IntentViewArg {
  name: string;
  desc: string;
  source?: string;
}

interface Props {
  primitives: ApiPrimitive[];
  agents: ApiStoredAgent[];
  learnedFunctions: ApiLearnedFunction[];
  hooks: ApiHook[];
  openIntent: (i: IntentViewArg) => void;
}

function synthLearnedFunctionTs(fn: ApiLearnedFunction): string {
  const lines: string[] = [
    `// learned function · ${fn.name}`,
    `// observer: ${fn.observer}`,
    `// created: ${fn.createdAt}`,
    `//`,
    `// ${fn.description}`,
    ``,
    `// signature: ${fn.signature}`,
    ``,
    fn.source,
  ];
  return lines.join("\n");
}

function pascalCase(s: string): string {
  return s
    .replace(/[._]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function synthPrimitiveTs(p: ApiPrimitive): string {
  const member = p.name.includes(".") ? p.name.split(".").slice(1).join(".") : p.name;
  const ifaceName = pascalCase(p.name);
  const sigBody = p.signature.replace(/^\s*[A-Za-z_][\w]*\s*\(/, `${member}(`);
  const isAgent = p.implementation === "flue" || p.implementation === "future-flue";
  const lines: string[] = [
    `// ${p.name}`,
    `// implementation: ${p.implementation}${isAgent ? "  ← LLM-driven (Flue agent)" : ""}`,
    `//`,
    `// ${p.description}`,
    ``,
    `export interface ${ifaceName} {`,
    `  ${sigBody};`,
    `}`,
  ];
  return lines.join("\n");
}

function synthAgentTs(a: ApiStoredAgent): string {
  const ifaceName = pascalCase(a.agentName);
  const lines: string[] = [
    `// learned primitive · ${a.agentName}`,
    `// capability: ${a.capability}`,
    `// runtime: flue (LLM-driven)`,
    `//`,
    `// ${a.description || "(no description in spec)"}`,
    ``,
    `// This typed primitive was created at runtime by an observer agent`,
    `// and saved to ~/.datafetch/agents/<tenant>/${a.agentName}.json so that`,
    `// future intents can re-bind to the same scorer without re-creating it.`,
    ``,
    `export interface ${ifaceName} {`,
    `  scoreUnit(args: {`,
    `    spec: OutlookScorerAgentSpec;`,
    `    unit: DocumentUnit;`,
    `    target: string;`,
    `    lens: "competitive_outlook";`,
    `  }): Promise<OutlookScore>;`,
    `}`,
  ];
  return lines.join("\n");
}

function badgeFor(impl: ApiPrimitive["implementation"]): { label: string; cls: string } {
  switch (impl) {
    case "flue":
      return { label: "flue agent", cls: "is-flue" };
    case "future-flue":
      return { label: "flue · planned", cls: "is-flue is-future" };
    case "atlas":
      return { label: "atlas search", cls: "is-atlas" };
    case "local":
      return { label: "deterministic", cls: "is-local" };
    case "pure":
      return { label: "pure", cls: "is-pure" };
  }
}

const NAMESPACE_HINT: Record<string, string> = {
  document_units: "evidence chunking",
  arithmetic: "pure math",
};

interface MemberPrimitive extends ApiPrimitive {
  member: string;
}

const NEW_HIGHLIGHT_MS = 2500;

function useNewlyAdded<T>(items: T[], keyOf: (t: T) => string): Set<string> {
  const seenRef = useRef<Set<string> | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentKeys = new Set(items.map(keyOf));
    if (seenRef.current === null) {
      seenRef.current = currentKeys;
      return;
    }
    const newlyAdded: string[] = [];
    for (const key of currentKeys) {
      if (!seenRef.current.has(key)) newlyAdded.push(key);
    }
    seenRef.current = currentKeys;
    if (newlyAdded.length === 0) return;

    setHighlighted((prev) => {
      const next = new Set(prev);
      for (const k of newlyAdded) next.add(k);
      return next;
    });
    const timers = newlyAdded.map((k) =>
      setTimeout(() => {
        setHighlighted((prev) => {
          if (!prev.has(k)) return prev;
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      }, NEW_HIGHLIGHT_MS)
    );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [items, keyOf]);

  return highlighted;
}

function synthHookTs(hook: ApiHook): string {
  return [
    `// hook · ${hook.name}`,
    `// intent: ${hook.intent}`,
    `// collections: ${hook.collections.join(", ")}`,
    ``,
    `/**`,
    ` * ${hook.description}`,
    ` *`,
    ` * Suggested route:`,
    ...hook.route.map((step, index) => ` *   ${index + 1}. ${step}`),
    ` */`,
    `export interface ${pascalCase(hook.name)}Intent {`,
    `  input: string;`,
    `}`,
  ].join("\n");
}

export function SystemPrimitivesPanel({ primitives, agents, learnedFunctions, hooks, openIntent }: Props) {
  const newAgents = useNewlyAdded(agents, (a) => a.agentName);
  const newLearnedFns = useNewlyAdded(learnedFunctions, (fn) => fn.name);

  const groups = new Map<string, MemberPrimitive[]>();
  for (const p of primitives) {
    const dot = p.name.indexOf(".");
    const ns = dot >= 0 ? p.name.slice(0, dot) : p.name;
    const member = dot >= 0 ? p.name.slice(dot + 1) : p.name;
    const list = groups.get(ns) ?? [];
    list.push({ ...p, member });
    groups.set(ns, list);
  }

  return (
    <aside className="v01-panel v01-panel--prims">
      <div className="v01-panel__sec">
        <div className="v01-panel__hd">
          <span>primitives · t=0</span>
          <span className="count">{primitives.length}</span>
        </div>
        <p className="v01-panel__sub">
          what the system has at boot. fixed.
        </p>
        {[...groups.entries()].map(([ns, members]) => (
          <div key={ns} className="v01-prim-grp">
            <div className="v01-prim-grp__hd">
              <span className="v01-prim-grp__ns">{ns}</span>
              {NAMESPACE_HINT[ns] && (
                <span className="v01-prim-grp__hint">{NAMESPACE_HINT[ns]}</span>
              )}
            </div>
            {members.map((m) => {
              const b = badgeFor(m.implementation);
              return (
                <button
                  key={m.name}
                  className={`v01-prim-row v01-prim-row--btn ${m.isAgent ? "is-agent" : ""}`}
                  title={`${m.signature}\n\n${m.description}\n\nclick to view as TypeScript`}
                  onClick={() =>
                    openIntent({
                      name: m.name,
                      desc: m.description,
                      source: synthPrimitiveTs(m),
                    })
                  }
                >
                  <span className={`v01-prim-row__dot ${b.cls}`} aria-hidden="true"></span>
                  <span className="v01-prim-row__name">{m.member}</span>
                  <span className={`v01-prim-row__badge ${b.cls}`}>{b.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="v01-panel__sec v01-panel__sec--learned">
        <div className="v01-panel__hd">
          <span>hooks</span>
          <span className="count">{hooks.length}</span>
        </div>
        <p className="v01-panel__sub">
          shared scaffolds for novel intents before a tenant has endorsed a procedure.
        </p>
        {hooks.map((hook) => (
          <button
            key={hook.name}
            className="v01-prim-row v01-prim-row--btn"
            title={`${hook.description}\n\nclick to view as TypeScript`}
            onClick={() =>
              openIntent({
                name: hook.name,
                desc: hook.description,
                source: synthHookTs(hook),
              })
            }
          >
            <span className="v01-prim-row__dot is-local" aria-hidden="true"></span>
            <span className="v01-prim-row__name">{hook.name}</span>
            <span className="v01-prim-row__badge is-local">hook</span>
          </button>
        ))}
      </div>

      <div className="v01-panel__sec v01-panel__sec--learned">
        <div className="v01-panel__hd">
          <span>learned primitives</span>
          <span className="count">{agents.length}</span>
        </div>
        <p className="v01-panel__sub">
          {agents.length === 0
            ? "nothing learned yet. flue-generated agents will appear here when a question demands LLM judgement."
            : "flue-generated agents this tenant has crystallised. reusable across question shapes."}
        </p>
        {agents.map((a) => (
          <button
            key={a.agentName}
            className={`v01-prim-row v01-prim-row--btn v01-prim-row--learned ${
              newAgents.has(a.agentName) ? "is-new" : ""
            }`}
            title={`${a.description}\n\nclick to view as TypeScript`}
            onClick={() =>
              openIntent({
                name: a.agentName,
                desc: a.description || `Learned primitive · ${a.capability}`,
                source: synthAgentTs(a),
              })
            }
          >
            <span className="v01-prim-row__dot is-flue" aria-hidden="true"></span>
            <span className="v01-prim-row__name">{a.agentName}</span>
            <span className="v01-prim-row__badge is-flue">flue agent</span>
          </button>
        ))}
      </div>

      <div className="v01-panel__sec v01-panel__sec--learned">
        <div className="v01-panel__hd">
          <span>learned functions</span>
          <span className="count">{learnedFunctions.length}</span>
        </div>
        <p className="v01-panel__sub">
          {learnedFunctions.length === 0
            ? "nothing learned yet. deterministic TS functions the observer codified will appear here for off-script questions."
            : "deterministic TS the observer wrote at runtime. cheap to call, reusable across sibling questions."}
        </p>
        {learnedFunctions.map((fn) => (
          <button
            key={fn.name}
            className={`v01-prim-row v01-prim-row--btn v01-prim-row--learned ${
              newLearnedFns.has(fn.name) ? "is-new" : ""
            }`}
            title={`${fn.signature}\n\n${fn.description}\n\nclick to view as TypeScript`}
            onClick={() =>
              openIntent({
                name: fn.name,
                desc: fn.description,
                source: synthLearnedFunctionTs(fn),
              })
            }
          >
            <span className="v01-prim-row__dot is-local" aria-hidden="true"></span>
            <span className="v01-prim-row__name">{fn.name}</span>
            <span className="v01-prim-row__badge is-local">deterministic</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
