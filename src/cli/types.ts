// Shared types for the CLI client modules. The flag shape mirrors the
// loose record `parseFlags()` produces in `src/cli.ts`: each flag value
// is a string, a boolean (presence-only), or a string[] for repeated
// flags like `--mount a --mount b`.

export type Flags = Record<string, string | boolean | string[]>;
