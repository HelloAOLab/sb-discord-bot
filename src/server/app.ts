import express, { type ErrorRequestHandler } from "express";
import { interactionsRouter } from "../interactions/router.js";
import { healthRouter } from "./routes/health.js";

export function createServer() {
  const app = express();

  // Must come before express.json(): signature verification needs the raw body.
  app.use("/interactions", interactionsRouter());

  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({ name: "sb-discord-app", status: "running" });
  });

  app.use("/health", healthRouter());

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("[server] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(errorHandler);

  return app;
}
