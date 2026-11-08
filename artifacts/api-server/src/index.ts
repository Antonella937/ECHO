import app from "./app";
import { probeFalImagePricing } from "./lib/falProviderPreflight";
import { publishDueScheduledPosts } from "./lib/scheduledPosts";
import { logger } from "./lib/logger";
import { startAutonomyBackgroundWorker } from "./autonomy/runtime";
import { AUTONOMY_LIVE_EXECUTION_ENABLED } from "./autonomy/constants";

// The worker is wired into the API process but remains dormant while the
// source-level live execution switch is false.
const autonomyWorker = AUTONOMY_LIVE_EXECUTION_ENABLED ? startAutonomyBackgroundWorker() : { stop() {} };

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Verify both image models without making a paid generation request.
  if (process.env.FAL_KEY) {
    void probeFalImagePricing(process.env.FAL_KEY)
      .then(result => logger.info({ imageModels: result.models.map(m => m.endpointId) }, "ECHO_IMAGE_PROVIDER_PREFLIGHT_OK"))
      .catch(error => logger.warn({ reason: error instanceof Error ? error.message : "UNKNOWN" }, "ECHO_IMAGE_PROVIDER_PREFLIGHT_FAILED"));
  }
});

process.on("SIGTERM", () => autonomyWorker.stop());
process.on("SIGINT", () => autonomyWorker.stop());

// Independent of the AI autonomy switch: scheduled posts are explicit owner instructions.
const scheduledInterval = setInterval(() => { void publishDueScheduledPosts(); }, 300000);
void publishDueScheduledPosts();
process.on("SIGTERM", () => clearInterval(scheduledInterval));
process.on("SIGINT", () => clearInterval(scheduledInterval));
