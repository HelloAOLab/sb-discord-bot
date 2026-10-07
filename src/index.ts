import { warmBibleCache } from "./bible/api.js";
import { config } from "./utils/config.js";
import { closeDatabase } from "./storage/database.js";
import { createServer } from "./server/app.js";

const app = createServer();

const server = app.listen(config.PORT, () => {
  console.log(`[server] Listening on http://localhost:${config.PORT}`);
  console.log(`[server] Interactions endpoint: POST /interactions`);
  warmBibleCache();
});

function shutdown() {
  server.close(() => closeDatabase());
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
