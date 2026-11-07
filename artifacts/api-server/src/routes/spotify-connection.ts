import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";

/** Spotify is opt-in per account. Never request passwords or expose app secrets.
 * Development-mode allowlisting and public API approval are controlled by Spotify.
 */
const router: IRouter = Router();
router.get("/music/spotify/availability", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const configured = Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_REDIRECT_URI);
  res.json({
    provider: "spotify",
    configured,
    connectionEnabled: false,
    reason: configured ? "OAUTH_FLOW_NOT_ACTIVATED" : "SPOTIFY_APP_CREDENTIALS_REQUIRED",
    userOptInRequired: true,
    passwordRequired: false,
    developmentAllowlistRequired: true,
  });
});
export default router;
