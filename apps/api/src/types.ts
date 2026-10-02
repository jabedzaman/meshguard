import type { Auth, Session, User } from "@meshguard/auth";
import type { Services } from "@meshguard/server-core";

export interface AppEnv {
  Variables: {
    requestId: string;
    auth: Auth;
    services: Services;
    user: User | null;
    session: Session | null;
  };
}
