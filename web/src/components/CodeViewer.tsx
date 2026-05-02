import { useEffect } from "react";
import { tsHighlight } from "../lib/tsHighlight";
import { INTENT_TS } from "../data/intentSource";

interface IntentInfo {
  name: string;
  desc: string;
  source?: string; // from state.procedures sourceMap
}

interface CodeViewerProps {
  intent: IntentInfo;
  onClose: () => void;
}

export function CodeViewer({ intent, onClose }: CodeViewerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const src =
    intent.source ||
    INTENT_TS[intent.name] ||
    `// no source available for ${intent.name}`;
  const html = tsHighlight(src);
  const lines = src.split("\n").length;

  return (
    <div className="v01-cv__scrim" onClick={onClose}>
      <div className="v01-cv" onClick={(e) => e.stopPropagation()}>
        <div className="v01-cv__hd">
          <div className="v01-cv__path">
            <span className="v01-cv__path-dim">intents/</span>
            <span>{intent.name}.ts</span>
          </div>
          <div className="v01-cv__meta">
            <span>typescript</span>
            <span>·</span>
            <span>{lines} lines</span>
          </div>
          <button className="v01-cv__x" onClick={onClose}>
            esc
          </button>
        </div>
        <div className="v01-cv__body">
          <pre className="v01-cv__lines">
            {Array.from({ length: lines })
              .map((_, i) => i + 1)
              .join("\n")}
          </pre>
          <pre
            className="v01-cv__src"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
        <div className="v01-cv__ft">
          <span className="v01-cv__ft-l">SUMMARY</span>
          <span>{intent.desc}</span>
        </div>
      </div>
    </div>
  );
}
