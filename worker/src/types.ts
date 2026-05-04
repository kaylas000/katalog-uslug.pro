export type Hyperdrive = { connectionString: string };

export interface Env {
  HYPERDRIVE?: Hyperdrive;
  /** Только для `wrangler dev` через `.dev.vars`. В проде — Hyperdrive. */
  DATABASE_URL?: string;
  ALLOWED_ORIGIN?: string;
}
