import type { Logger } from "pino";

declare module "express-serve-static-core" {
  interface Request {
    /** Attached at runtime by the pino-http middleware in app.ts. */
    log: Logger;
  }
}

export {};
