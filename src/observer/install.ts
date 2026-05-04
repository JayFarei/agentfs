// Observer install entry point.
//
// Constructs an `Observer` and registers its `observe` as the snippet
// runtime's `onTrajectorySaved` callback. Idempotent: subsequent calls
// replace the callback with a fresh observer bound to the new opts.
//
// The snippet runtime exposed by `installSnippetRuntime({...})` has an
// optional `onTrajectorySaved` field. We set it here.

import { defaultBaseDir } from "../paths.js";
import { DiskSnippetRuntime } from "../snippet/runtime.js";

import { Observer, type ObserverOpts, type ObserveResult } from "./worker.js";

export type InstallObserverOpts = ObserverOpts & {
  // The snippet runtime to attach to. If omitted, the caller is
  // expected to attach the returned observer to its own runtime via
  // `runtime.onTrajectorySaved = (id) => observer.observe(id)`.
  snippetRuntime?: DiskSnippetRuntime;
};

export type InstallObserverResult = {
  observer: Observer;
  baseDir: string;
};

export function installObserver(
  opts: InstallObserverOpts = {},
): InstallObserverResult {
  const baseDir = opts.baseDir ?? defaultBaseDir();

  const observerOpts: ObserverOpts = { baseDir };
  if (opts.tenantId !== undefined) observerOpts.tenantId = opts.tenantId;
  if (opts.codifierSkill !== undefined) {
    observerOpts.codifierSkill = opts.codifierSkill;
  }
  if (opts.libraryResolver !== undefined) {
    observerOpts.libraryResolver = opts.libraryResolver;
  }

  const observer = new Observer(observerOpts);

  if (opts.snippetRuntime) {
    opts.snippetRuntime.onTrajectorySaved = (id: string): void => {
      // Fire-and-forget; the observer's promise is tracked on
      // `observer.observerPromise` for tests.
      void observer.observe(id).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[observer] observe(${id}) crashed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    };
  }

  return { observer, baseDir };
}

export type { ObserveResult };
