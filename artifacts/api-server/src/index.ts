import app from "./app";
import { logger } from "./lib/logger";
import { startAutonomyBackgroundWorker } from "./autonomy/runtime";

// The worker is wired into the API process but remains dormant while the
// source-level live execution switch is false.
const autonomyWorker = startAutonomyBackgroundWorker();

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
});

process.on("SIGTERM", () => autonomyWorker.stop());
process.on("SIGINT", () => autonomyWorker.stop());
