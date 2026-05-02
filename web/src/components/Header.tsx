import type { TenantId } from "@server/types";

interface UserEntry {
  name: string;
}

type ActiveView = "overview" | TenantId;

interface HeaderProps {
  active: ActiveView;
  setActive: (v: ActiveView) => void;
  openHow: () => void;
  users: { alice: UserEntry; bob: UserEntry };
}

export function Header({ active, setActive, openHow, users }: HeaderProps) {
  const aliceName = users.alice.name.toLowerCase();
  const bobName = users.bob.name.toLowerCase();

  return (
    <header className="v01-hdr">
      <div className="v01-hdr__brand">
        <span className="v01-hdr__wm">
          <span className="pre">atlas</span>
          <span className="post">fs</span>
        </span>
        <span className="v01-hdr__ver">v0.1</span>
      </div>
      <div className="v01-hdr__users">
        <button
          className={`v01-hdr__pill ${active === "overview" ? "is-on" : ""}`}
          onClick={() => setActive("overview")}
        >
          <span className="ico">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            >
              <rect x="2" y="2" width="5" height="5" />
              <rect x="9" y="2" width="5" height="5" />
              <rect x="2" y="9" width="5" height="5" />
              <rect x="9" y="9" width="5" height="5" />
            </svg>
          </span>
          <span>overview</span>
        </button>
        {(["alice", "bob"] as const).map((k) => (
          <button
            key={k}
            className={`v01-hdr__pill ${active === k ? "is-on" : ""}`}
            onClick={() => setActive(k)}
          >
            <span className="avatar" data-who={k}>
              <svg
                width="11"
                height="11"
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
            <span>
              {k === "alice" ? aliceName : bobName}{" "}
              <span className="agent-tag">agent</span>
            </span>
          </button>
        ))}
      </div>
      <div className="v01-hdr__cluster">
        <button
          className="v01-hdr__how"
          title="How AtlasFS works"
          onClick={openHow}
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
            <path
              d="M6.2 6.2 a1.8 1.8 0 1 1 2.6 1.6 c-0.6 0.4 -0.8 0.7 -0.8 1.4"
              strokeLinecap="round"
            />
            <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
          </svg>
          <span>how it works</span>
        </button>
      </div>
    </header>
  );
}
