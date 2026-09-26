import fs from "node:fs";
import path from "node:path";
import { readJson, withJson } from "./json-store";
import type { State } from "./types";

const EMPTY: State = { concerts: [], agents: [], grants: [], attempts: [] };

export function repoRoot(): string {
  if (process.env.REALCLANKER_ROOT) return process.env.REALCLANKER_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function normalize(parsed: Partial<State> | null | undefined): State {
  return {
    concerts: parsed?.concerts ?? [],
    agents: parsed?.agents ?? [],
    grants: parsed?.grants ?? [],
    attempts: parsed?.attempts ?? [],
  };
}

export async function readState(): Promise<State> {
  return normalize(await readJson<State>("state.json", EMPTY));
}

export async function withState<T>(mutate: (state: State) => T): Promise<T> {
  return withJson("state.json", EMPTY, (draft) => {
    const state = normalize(draft);
    draft.concerts = state.concerts;
    draft.agents = state.agents;
    draft.grants = state.grants;
    draft.attempts = state.attempts;
    return mutate(draft);
  });
}
