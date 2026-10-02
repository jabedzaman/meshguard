/** True if `error` (or its cause, as wrapped by Drizzle) is a Postgres unique violation on `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === "23505" && pg.constraint === constraint) return true;
  }
  return false;
}
