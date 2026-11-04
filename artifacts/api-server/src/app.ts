import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Private beta: only explicitly invited Clerk identities may access API data.
// Configure ECHO_BETA_ALLOWED_USER_IDS as up to three comma-separated Clerk user IDs.
// Production fails closed when the allowlist is absent or invalid.
const betaIdsRaw = process.env.ECHO_BETA_ALLOWED_USER_IDS?.trim() ?? "";
const betaIds = betaIdsRaw.split(",").map(id => id.trim()).filter(Boolean);
const betaConfigured = betaIds.length > 0 && betaIds.length <= 3 &&
  new Set(betaIds).size === betaIds.length && betaIds.every(id => /^user_[A-Za-z0-9]+$/.test(id));
if (process.env.NODE_ENV === "production" && !betaConfigured) {
  throw new Error("ECHO_BETA_ALLOWED_USER_IDS must contain 1 to 3 distinct Clerk user IDs in production");
}
app.use("/api", (req, res, next) => {
  if (req.path === "/healthz") return next();
  if (!betaConfigured && process.env.NODE_ENV !== "production") return next();
  res.setHeader("Cache-Control", "private, no-store");
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!betaIds.includes(userId)) { res.status(403).json({ error: "PRIVATE_BETA_ACCESS_REQUIRED" }); return; }
  next();
});

app.use("/api", router);

export default app;
