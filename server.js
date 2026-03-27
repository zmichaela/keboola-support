import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { helloHandler } from "./api/hello.js";
import { bucketsHandler, tableDetailHandler } from "./api/kbc.js";
import { streamHandler } from "./api/stream.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

app.all("/api/hello", helloHandler);
app.get("/api/stream", streamHandler);

// Keboola Storage API examples (requires secrets KBC_URL + KBC_TOKEN)
app.get("/api/kbc/buckets", bucketsHandler);
app.get("/api/kbc/tables/:tableId", tableDetailHandler);

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

