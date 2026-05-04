import { useState, useEffect, useRef } from "react";
import type {
  StateResponse,
  TenantId,
  ApiSuggestedQuestion,
  ApiPrimitive,
  ApiStoredAgent,
  ApiLearnedFunction,
  ApiHook,
  ApiEvalMetric,
} from "@server/types";
import {
  fetchState,
  runQuery,
  endorse as endorseApi,
  resetTenant as resetTenantApi,
} from "./api/client";
import { Header } from "./components/Header";
import { Overview } from "./components/Overview";
import { UserView } from "./components/UserView";
import { CodeViewer } from "./components/CodeViewer";
import { HowItWorks } from "./components/HowItWorks";
import type { RunState } from "./components/RunView";
import type { ProcEntry } from "./components/ProcPanel";
import type { IntentEntry } from "./components/IntentPanel";

type ActiveView = "overview" | TenantId;

interface IntentViewArg {
  name: string;
  desc: string;
  source?: string;
}

interface TenantSlot {
  state: StateResponse | null;
  query: string;
  run: RunState | null;
}

function emptySlot(): TenantSlot {
  return { state: null, query: "", run: null };
}

function viewFromState(state: StateResponse | null) {
  if (!state) return null;
  return {
    name: state.agent.name,
    role: state.agent.role,
    tenant: state.agent.tenant as TenantId,
    pathLabel: state.agent.pathLabel,
    data: state.cluster.collections,
    procedures: state.procedures.map(
      (p): ProcEntry => ({
        name: p.name,
        sig: p.sig,
        hits: p.hits,
        stage: p.stage,
      })
    ),
    intents: state.intents.map(
      (i): IntentEntry => ({
        name: i.name,
        desc: i.desc,
        params: i.params,
        sourceTs: i.sourceTs,
      })
    ),
    cluster: state.cluster,
    suggested: state.suggested as ApiSuggestedQuestion[],
    primitives: (state.primitives ?? []) as ApiPrimitive[],
    agents: (state.agents ?? []) as ApiStoredAgent[],
    learnedFunctions: (state.learnedFunctions ?? []) as ApiLearnedFunction[],
    hooks: (state.hooks ?? []) as ApiHook[],
    drift: state.drift ?? [],
    evalMetrics: (state.evalMetrics ?? []) as ApiEvalMetric[],
    sourceMap: Object.fromEntries(
      state.procedures.map((p) => [p.name, p.source])
    ),
  };
}

export default function App() {
  const [active, setActive] = useState<ActiveView>("overview");
  const [connecting, setConnecting] = useState(true);

  const [slots, setSlots] = useState<Record<TenantId, TenantSlot>>({
    alice: emptySlot(),
    bob: emptySlot(),
    "financial-analyst": emptySlot(),
  });

  const [intentView, setIntentView] = useState<IntentViewArg | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // Load state for both tenants on mount
  const loadAll = () => {
    setConnecting(true);
    Promise.all([fetchState("alice"), fetchState("bob")])
      .then(([a, b]) => {
        setSlots((prev) => ({
          ...prev,
          alice: { ...prev.alice, state: a },
          bob: { ...prev.bob, state: b },
        }));
        setConnecting(false);
      })
      .catch(() => setConnecting(false));
  };
  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    clearTimers();
  }, [active]);

  const refreshTenant = async (tenant: TenantId) => {
    try {
      const newState = await fetchState(tenant);
      setSlots((prev) => ({ ...prev, [tenant]: { ...prev[tenant], state: newState } }));
    } catch {
      // silent
    }
  };

  const setSlot = (tenant: TenantId, patch: Partial<TenantSlot>) =>
    setSlots((prev) => ({ ...prev, [tenant]: { ...prev[tenant], ...patch } }));

  const submit = async (tenant: TenantId, q: string, procName?: string) => {
    if (!q || !q.trim()) return;
    clearTimers();

    // Snapshot pre-run procedures + agents so we can compute artifact delta
    const preProcs = new Set(slots[tenant].state?.procedures.map((p) => p.name) ?? []);
    const preAgents = new Set((slots[tenant].state?.agents ?? []).map((a) => a.agentName));

    const initialRun: RunState = {
      query: q,
      procName: procName ?? null,
      result: null,
      mode: null,
      trajectoryId: undefined,
      endorsing: false,
      endorsed: false,
      inflight: true,
      done: false,
      calls: [],
      callsRevealed: 0,
      artifactsAdded: [],
    };

    setSlot(tenant, { run: initialRun });

    try {
      const resp = await runQuery({ question: q, suggestedProcedure: procName }, tenant);

      // Seed mode + calls + procName so the run-view header updates immediately
      setSlots((prev) => {
        const slot = prev[tenant];
        if (!slot.run) return prev;
        return {
          ...prev,
          [tenant]: {
            ...slot,
            run: {
              ...slot.run,
              calls: resp.calls,
              mode: resp.mode,
              trajectoryId: resp.trajectoryId,
              procName: resp.procedureName ?? slot.run.procName,
            },
          },
        };
      });

      // Reveal the real primitive calls one by one — feels alive without faking
      const totalCalls = resp.calls.length;
      const perCall = totalCalls > 0
        ? Math.max(140, Math.min(360, Math.round(1600 / Math.max(totalCalls, 1))))
        : 0;
      let acc = 0;
      for (let i = 1; i <= totalCalls; i += 1) {
        acc += perCall;
        const t = setTimeout(() => {
          setSlots((prev) => {
            const slot = prev[tenant];
            if (!slot.run) return prev;
            return {
              ...prev,
              [tenant]: { ...slot, run: { ...slot.run, callsRevealed: i } },
            };
          });
        }, acc);
        timers.current.push(t);
      }

      const doneTimer = setTimeout(() => {
        setSlots((prev) => {
          const slot = prev[tenant];
          if (!slot.run) return prev;
          return {
            ...prev,
            [tenant]: {
              ...slot,
              run: {
                ...slot.run,
                inflight: false,
                done: true,
                result: resp.result,
                callsRevealed: totalCalls,
              },
            },
          };
        });
        // Refresh state, then compute artifact delta against the pre-run snapshot
        void (async () => {
          try {
            const newState = await fetchState(tenant);
            const newProcs = newState.procedures.map((p) => p.name);
            const newAgents = (newState.agents ?? []).map((a) => a.agentName);
            const added: string[] = [];
            for (const name of newProcs) {
              if (!preProcs.has(name)) {
                added.push(`procedures/${name}.json`);
                added.push(`procedures/${name}.ts`);
              }
            }
            for (const name of newAgents) {
              if (!preAgents.has(name)) added.push(`agents/${name}.json`);
            }
            setSlots((prev) => {
              const slot = prev[tenant];
              return {
                ...prev,
                [tenant]: {
                  ...slot,
                  state: newState,
                  run: slot.run ? { ...slot.run, artifactsAdded: added } : slot.run,
                },
              };
            });
          } catch {
            // silent
          }
        })();
      }, acc + 200);
      timers.current.push(doneTimer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSlot(tenant, {
        run: {
          ...initialRun,
          inflight: false,
          done: true,
          mode: "novel",
          errorMessage: msg,
          result: {
            title: "Error",
            answer: "—",
            detail: msg,
            cite: "—",
            procedure: "(error)",
          },
        },
      });
    }
  };

  const reset = (tenant: TenantId) => {
    clearTimers();
    setSlot(tenant, { run: null, query: "" });
  };

  const startOver = async (tenant: TenantId) => {
    clearTimers();
    try {
      await resetTenantApi(tenant);
      await refreshTenant(tenant);
      setSlot(tenant, { run: null, query: "" });
    } catch (e) {
      console.warn("reset failed", e);
    }
  };

  const handleEndorse = async (tenant: TenantId, trajectoryId: string) => {
    setSlots((prev) => {
      const slot = prev[tenant];
      if (!slot.run) return prev;
      return { ...prev, [tenant]: { ...slot, run: { ...slot.run, endorsing: true } } };
    });
    try {
      await endorseApi({ trajectoryId }, tenant);
      await refreshTenant(tenant);
      setSlots((prev) => {
        const slot = prev[tenant];
        if (!slot.run) return prev;
        return {
          ...prev,
          [tenant]: { ...slot, run: { ...slot.run, endorsing: false, endorsed: true } },
        };
      });
    } catch {
      setSlots((prev) => {
        const slot = prev[tenant];
        if (!slot.run) return prev;
        return { ...prev, [tenant]: { ...slot, run: { ...slot.run, endorsing: false } } };
      });
    }
  };

  const aliceView = viewFromState(slots.alice.state);
  const bobView = viewFromState(slots.bob.state);

  return (
    <div className="v01">
      <Header
        active={active}
        setActive={setActive}
        openHow={() => setHowOpen(true)}
        users={{
          alice: { name: aliceView?.name ?? "Tenant A" },
          bob: { name: bobView?.name ?? "Tenant B" },
        }}
      />

      {connecting && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            padding: "4px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.1em",
            color: "var(--text-muted)",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          connecting…
        </div>
      )}

      {active === "overview" ? (
        <Overview
          alice={
            aliceView
              ? {
                  name: aliceView.name,
                  role: aliceView.role,
                  tenant: aliceView.tenant,
                  procedures: aliceView.procedures,
                  primitives: aliceView.primitives,
                  data: aliceView.data,
                }
              : null
          }
          bob={
            bobView
              ? {
                  name: bobView.name,
                  role: bobView.role,
                  tenant: bobView.tenant,
                  procedures: bobView.procedures,
                  primitives: bobView.primitives,
                  data: bobView.data,
                }
              : null
          }
          cluster={aliceView?.cluster ?? bobView?.cluster ?? null}
          setActive={setActive}
        />
      ) : (
        (() => {
          const tenant = active;
          const view = tenant === "alice" ? aliceView : bobView;
          const slot = slots[tenant];
          return (
            <UserView
              name={view?.name ?? (tenant === "alice" ? "Tenant A" : "Tenant B")}
              role={view?.role ?? ""}
              tenant={tenant}
              pathLabel={view?.pathLabel ?? ""}
              procedures={view?.procedures ?? []}
              primitives={view?.primitives ?? []}
              agents={view?.agents ?? []}
              learnedFunctions={view?.learnedFunctions ?? []}
              hooks={view?.hooks ?? []}
              drift={view?.drift ?? []}
              evalMetrics={view?.evalMetrics ?? []}
              data={view?.data ?? []}
              cluster={view?.cluster ?? null}
              suggested={view?.suggested ?? []}
              sourceMap={view?.sourceMap ?? {}}
              query={slot.query}
              setQuery={(q) => setSlot(tenant, { query: q })}
              submit={(q, p) => void submit(tenant, q, p)}
              run={slot.run}
              reset={() => reset(tenant)}
              startOver={() => void startOver(tenant)}
              openIntent={setIntentView}
              onEndorse={(tid) => void handleEndorse(tenant, tid)}
            />
          );
        })()
      )}

      {intentView && <CodeViewer intent={intentView} onClose={() => setIntentView(null)} />}
      {howOpen && <HowItWorks onClose={() => setHowOpen(false)} />}
    </div>
  );
}
