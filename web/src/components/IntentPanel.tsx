import { tsHighlight, buildIntentSignature } from "../lib/tsHighlight";

export interface IntentEntry {
  name: string;
  desc: string;
  params: readonly string[];
  sourceTs?: string;
}

interface IntentViewArg {
  name: string;
  desc: string;
  source?: string;
}

interface IntentPanelProps {
  intents: IntentEntry[];
  openIntent: (i: IntentViewArg) => void;
}

export function IntentPanel({ intents, openIntent }: IntentPanelProps) {
  return (
    <aside className="v01-panel">
      <div className="v01-panel__sec">
        <div className="v01-panel__hd">
          <span>typed interface</span>
          <span className="count">{intents.length}</span>
        </div>
        {intents.map((i) => {
          const ts = buildIntentSignature(i);
          return (
            <button
              key={i.name}
              className="v01-intent v01-intent--btn"
              onClick={() =>
                openIntent({ name: i.name, desc: i.desc, source: i.sourceTs })
              }
            >
              <pre
                className="v01-intent__code"
                dangerouslySetInnerHTML={{ __html: tsHighlight(ts) }}
              />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
