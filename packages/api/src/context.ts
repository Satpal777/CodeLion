import type { Database, User } from "@reviewer/db";

export interface Principal {
  user: User;
  workspaceId: string;
  role: "owner" | "admin" | "maintainer" | "viewer";
}

export interface AppEvent {
  name: string;
  data: Record<string, string | number | boolean | null>;
}

export interface TRPCContext {
  database: Database;
  principal: Principal | null;
  requestId: string;
  sendEvent?: (event: AppEvent) => Promise<void>;
}
