import type { Auth, Session, User } from "@mesh/auth";
import type { Services } from "@mesh/server-core";

export interface AppEnv {
  Variables: {
    requestId: string;
    auth: Auth;
    services: Services;
    user: User | null;
    session: Session | null;
  };
}
