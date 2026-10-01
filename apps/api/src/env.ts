import type { Session, User } from "@mesh/auth";

export interface AppEnv {
  Variables: {
    user: User | null;
    session: Session | null;
  };
}

/** Env for handlers behind requireAuth, where a session is guaranteed. */
export interface AuthedEnv {
  Variables: {
    user: User;
    session: Session;
  };
}
