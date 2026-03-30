import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { supportSummaryHandler } from "./api/support.js";
import {
  aggregateTableHandler,
  listTablesHandler,
  previewTableHandler,
  schemaTableHandler,
} from "./api/tables.js";
import { overviewTrendsHandler } from "./api/overview.js";
import { slaPerformanceHandler } from "./api/slaPerformance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// Support dashboard (Input Mapping table: client_sla_summary)
app.get("/api/support/summary", supportSummaryHandler);
app.get("/api/overview/trends", overviewTrendsHandler);
app.get("/api/sla/performance", slaPerformanceHandler);

// Generic access to input-mapped CSVs (multiple tables)
app.get("/api/tables", listTablesHandler);
app.get("/api/tables/:key/preview", previewTableHandler);
app.get("/api/tables/:key/schema", schemaTableHandler);
app.get("/api/tables/:key/aggregate", aggregateTableHandler);

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

