import { useEffect, useRef, useState } from "react";
import { tsHighlight, buildTsSignature } from "../lib/tsHighlight";

export interface ProcEntry {
  name: string;
  sig: string;
  hits: number;
  stage: string;
}

interface IntentViewArg {
  name: string;
  desc: string;
  source?: string;
}

interface ProcPanelProps {
  tenant: string;
  procedures: ProcEntry[];
  sourceMap: Record<string, string>;
  openIntent: (i: IntentViewArg) => void;
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

export function ProcPanel({
  procedures,
  sourceMap,
  openIntent,
}: ProcPanelProps) {
  const newProcs = useNewlyAdded(procedures, (p) => p.name);

  return (
    <aside className="v01-panel v01-panel--learned">
      <div className="v01-panel__sec">
        <div className="v01-panel__hd">
          <span>learned chains</span>
          <span className="count">{procedures.length}</span>
        </div>
        <p className="v01-panel__sub">
          {procedures.length === 0
            ? "no chains yet. each crystallised run becomes a one-call replay here."
            : "compiled procedures bound to intents. each replays as one call."}
        </p>
        {procedures.map((p) => {
          const ts = buildTsSignature(p.name, p.sig);
          return (
            <button
              key={p.name}
              className={`v01-proc v01-proc--btn ${p.stage === "family" ? "is-family" : ""} ${
                newProcs.has(p.name) ? "is-new" : ""
              }`}
              onClick={() =>
                openIntent({
                  name: p.name,
                  desc: `Compiled chain · ${p.stage} · ${p.hits} hits`,
                  source: sourceMap[p.name],
                })
              }
            >
              <pre
                className="v01-proc__code"
                dangerouslySetInnerHTML={{ __html: tsHighlight(ts) }}
              />
              <div className="v01-proc__foot">
                <span className="stage">{p.stage}</span>
                <span>·</span>
                <span>{p.hits} hits</span>
                <span className="open-link">view .ts</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
