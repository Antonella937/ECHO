import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import router from "./routes";
import { ensureCreatorProfile } from "./lib/creatorProfileBootstrap";
import { isAutonomyDmTyping } from "./autonomy/service";
import { privateBetaSeats } from "./middlewares/privateBetaSeats";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
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
const permittedOrigins = (process.env.ECHO_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || permittedOrigins.includes(origin) || (process.env.NODE_ENV !== "production" && permittedOrigins.length === 0)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Public liveness probe: must not require Clerk, a beta seat, or database access.
app.get("/api/healthz", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ status: "ok" });
});

// Render receives the API hostname, not the Cloudflare frontend hostname.
// Use the configured Clerk instance keys directly for token verification.
app.use(clerkMiddleware({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
}));

// Launch readiness: public access is opt-in, never inferred from missing beta settings.
// Existing private-beta deployments keep their current admission behavior.
const accessMode = process.env.ECHO_ACCESS_MODE?.trim() ?? "private_beta";
const publicLaunchApproved = process.env.ECHO_PUBLIC_LAUNCH_APPROVED === "true";
if (!["private_beta", "public"].includes(accessMode)) {
  throw new Error("ECHO_ACCESS_MODE must be private_beta or public");
}
if (accessMode === "public" && !publicLaunchApproved) {
  throw new Error("Public access requires ECHO_PUBLIC_LAUNCH_APPROVED=true");
}
if (accessMode === "public" && process.env.NODE_ENV !== "production") {
  throw new Error("Public access requires NODE_ENV=production");
}
const betaIdsRaw = process.env.ECHO_BETA_ALLOWED_USER_IDS?.trim() ?? "";
const betaIds = betaIdsRaw.split(",").map(id => id.trim()).filter(Boolean);
const betaConfigured = betaIds.length > 0 && betaIds.length <= 3 &&
  new Set(betaIds).size === betaIds.length && betaIds.every(id => /^user_[A-Za-z0-9]+$/.test(id));
const betaSeatMode = process.env.ECHO_BETA_ACCESS_MODE === "three_seats";
if (process.env.NODE_ENV === "production" && permittedOrigins.length === 0) {
  throw new Error("ECHO_ALLOWED_ORIGINS must specify the production frontend origin");
}
if (process.env.NODE_ENV === "production" && accessMode === "private_beta" && !betaConfigured && !betaSeatMode) {
  throw new Error("ECHO_BETA_ALLOWED_USER_IDS must contain 1 to 3 distinct Clerk user IDs in production");
}
const betaAllowlistGate: express.RequestHandler = (req, res, next) => {
  if (req.path === "/healthz") return next();
  if (!betaConfigured && process.env.NODE_ENV !== "production") return next();
  res.setHeader("Cache-Control", "private, no-store");
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!betaIds.includes(userId)) { res.status(403).json({ error: "PRIVATE_BETA_ACCESS_REQUIRED" }); return; }
  next();
};
const publicAccountGate: express.RequestHandler = (req, res, next) => {
  if (req.path === "/healthz") return next();
  res.setHeader("Cache-Control", "private, no-store");
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
};
app.use("/api", accessMode === "public" ? publicAccountGate : betaSeatMode ? privateBetaSeats : betaAllowlistGate);

// Register a private Creator Hub profile as soon as an account uses ECHO, not when Creator Hub opens.
app.use("/api", async (req, _res, next) => {
  if (req.path === "/healthz") return next();
  const ownerId = getAuth(req).userId;
  if (ownerId) {
    try { await ensureCreatorProfile(ownerId); }
    catch (error) { logger.warn({ error: error instanceof Error ? error.message : "unknown" }, "Creator Hub automatic profile registration failed"); }
  }
  next();
});

app.get("/api/autonomy/typing", (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const ownerId = getAuth(req).userId;
  if (!ownerId) { res.status(401).json({ error: "Authentication required" }); return; }
  const universeId = String(req.query.universeId ?? "primary");
  const characterId = String(req.query.characterId ?? "");
  if (universeId.length > 128 || characterId.length > 128 || !characterId) {
    res.status(400).json({ error: "Invalid query" }); return;
  }
  res.json({ typing: isAutonomyDmTyping(ownerId, universeId, characterId) });
});

app.use("/api", router);

export default app;
