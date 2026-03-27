import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { supportSummaryHandler } from "./api/support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// Support dashboard (Input Mapping table: client_sla_summary)
app.get("/api/support/summary", supportSummaryHandler);

// Keboola platform sends a POST to "/" on startup, so handle all methods here.
app.all("/", (req, res) => {
  res
    .status(200)
    .type("html")
    .sendFile(join(__dirname, "static", "index.html"));
});

app.use(express.static(join(__dirname, "static"), { index: false }));

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`app listening on http://${HOST}:${PORT}`);
});

