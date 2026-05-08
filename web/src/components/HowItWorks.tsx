import { useEffect } from "react";

interface HowItWorksProps {
  onClose: () => void;
}

export function HowItWorks({ onClose }: HowItWorksProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="v01-cv__scrim" onClick={onClose}>
      <div className="v01-how" onClick={(e) => e.stopPropagation()}>
        <div className="v01-cv__hd">
          <div className="v01-cv__path">
            <span className="v01-cv__path-dim">datafetch/</span>
            <span>how-it-works.md</span>
          </div>
          <div className="v01-cv__meta">
            <span>readme</span>
            <span>·</span>
            <span>v0.1</span>
          </div>
          <button className="v01-cv__x" onClick={onClose}>
            esc
          </button>
        </div>
        <div className="v01-how__body">
          <div className="v01-how__hero">
            <div className="v01-how__l">DATAFETCH - HOW IT WORKS</div>
            <h1 className="v01-how__title">
              Mount a dataset. Commit visible trajectories. Let the interface
              grow.
            </h1>
            <p className="v01-how__lede">
              The first time an agent asks a new question, it explores through
              a dataset workspace and writes the repeatable logic into code.
              After commit, reusable trajectories can become typed interfaces.
            </p>
          </div>

          <div className="v01-how__stages">
            <div className="v01-how__stage" data-stage="1">
              <div className="v01-how__stage-n">STAGE 1</div>
              <div className="v01-how__stage-name">NOVEL</div>
              <div className="v01-how__stage-desc">AI explores</div>
              <div className="v01-how__stage-cost">
                <span className="dot dot--3"></span>
                <span className="dot dot--3"></span>
                <span className="dot dot--3"></span> slow
              </div>
            </div>
            <div className="v01-how__arrow">→</div>
            <div className="v01-how__stage" data-stage="2">
              <div className="v01-how__stage-n">STAGE 2</div>
              <div className="v01-how__stage-name">ENDORSED</div>
              <div className="v01-how__stage-desc">you bless it</div>
              <div className="v01-how__stage-cost">
                <span className="dot dot--2"></span>
                <span className="dot dot--2"></span> medium
              </div>
            </div>
            <div className="v01-how__arrow">→</div>
            <div className="v01-how__stage" data-stage="3">
              <div className="v01-how__stage-n">STAGE 3</div>
              <div className="v01-how__stage-name">COMPILED</div>
              <div className="v01-how__stage-desc">single pipeline</div>
              <div className="v01-how__stage-cost">
                <span className="dot dot--1"></span> instant
              </div>
            </div>
          </div>

          <div className="v01-how__example">
            <div className="v01-how__ex-hd">EXAMPLE</div>
            <div className="v01-how__ex-row">
              <div className="v01-how__ex-tag">ask</div>
              <div className="v01-how__ex-body">
                <div className="v01-how__ex-q">
                  "avg payment volume per transaction for Amex?"
                </div>
                <div className="v01-how__ex-meta">
                  → 5 exploratory steps · answer <b>127.4</b>
                </div>
                <div className="v01-how__ex-meta">→ trajectory recorded</div>
              </div>
            </div>
            <div className="v01-how__ex-row">
              <div className="v01-how__ex-tag">endorse</div>
              <div className="v01-how__ex-body">
                <div className="v01-how__ex-cmd">
                  $ datafetch commit scripts/answer.ts
                </div>
                <div className="v01-how__ex-meta">→ chain saved</div>
              </div>
            </div>
            <div className="v01-how__ex-row">
              <div className="v01-how__ex-tag">reuse</div>
              <div className="v01-how__ex-body">
                <div className="v01-how__ex-q">"...for JCB?"</div>
                <div className="v01-how__ex-meta">
                  → 1 call · answer <b>91.67</b>
                </div>
              </div>
            </div>
          </div>

          <div className="v01-how__close">
            <p>
              Every accepted commit gives the observer a visible program,
              evidence, and tests to learn from. The library <em>is</em> the
              interface: parameters in, answer envelope out, shaped by the
              questions agents actually ask.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
