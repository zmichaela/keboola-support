import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

const TABLES = [
  { key: "client_sla_summary", label: "Client SLA summary", file: "client_sla_summary.csv" },
  { key: "issues_enriched", label: "Issues enriched", file: "issues_enriched.csv" },
  { key: "client_sla_summary_2", label: "Client SLA summary (v2)", file: "client_sla_summary_2.csv" },
  { key: "daily_trends", label: "Daily trends", file: "daily_trends.csv" },
  { key: "client_performance", label: "Client performance", file: "client_performance.csv" },
  { key: "priority_severity_analysis", label: "Priority & severity analysis", file: "priority_severity_analysis.csv" },
  { key: "weekly_trends", label: "Weekly trends", file: "weekly_trends.csv" },
  { key: "agent_performance", label: "Agent performance", file: "agent_performance.csv" },
  { key: "sla_compliance", label: "SLA compliance", file: "sla_compliance.csv" },
];

const cache = new Map(); // key -> { tablePath, mtimeMs, rows }

function baseDataDir() {
  return process.env.KBC_DATADIR ? path.join(process.env.KBC_DATADIR) : "/data";
}

function tablePathFor(def) {
  return path.join(baseDataDir(), "in", "tables", def.file);
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replaceAll(",", "."));
  return Number.isFinite(n) ? n : null;
}

function inferType(values) {
  let nNum = 0;
  let nDate = 0;
  let nBool = 0;
  let nNonEmpty = 0;

  for (const v of values) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    nNonEmpty += 1;

    const low = s.toLowerCase();
    if (["true", "false", "yes", "no", "0", "1"].includes(low)) nBool += 1;

    const n = toNumber(s);
    if (n !== null) nNum += 1;

    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) nDate += 1;
  }

  if (nNonEmpty === 0) return "empty";
  if (nNum / nNonEmpty > 0.9) return "number";
  if (nDate / nNonEmpty > 0.9) return "date";
  if (nBool / nNonEmpty > 0.9) return "boolean";
  return "string";
}

async function readCsvCached(def) {
  const tPath = tablePathFor(def);
  const st = await fs.stat(tPath);
  const c = cache.get(def.key);
  if (c && c.tablePath === tPath && c.mtimeMs === st.mtimeMs) return { tablePath: tPath, rows: c.rows };

  const csv = await fs.readFile(tPath, "utf8");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });

  cache.set(def.key, { tablePath: tPath, mtimeMs: st.mtimeMs, rows });
  return { tablePath: tPath, rows };
}

function getDef(key) {
  return TABLES.find((t) => t.key === key) ?? null;
}

export async function listTablesHandler(_req, res) {
  const out = [];
  for (const t of TABLES) {
    const p = tablePathFor(t);
    try {
      const st = await fs.stat(p);
      out.push({ ...t, path: p, exists: true, sizeBytes: st.size, mtime: st.mtime.toISOString() });
    } catch (e) {
      out.push({ ...t, path: p, exists: false });
    }
  }
  res.status(200).json({ ok: true, dataDir: baseDataDir(), tables: out });
}

export async function previewTableHandler(req, res) {
  try {
    const def = getDef(req.params.key);
    if (!def) return res.status(404).json({ ok: false, message: "Unknown table key" });

    const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit ?? "25", 10) || 25));
    const { tablePath, rows } = await readCsvCached(def);

    res.status(200).json({
      ok: true,
      table: def,
      tablePath,
      rows: rows.slice(0, limit),
      totalRows: rows.length,
    });
  } catch (e) {
    const msg =
      e?.code === "ENOENT"
        ? "Input-mapped CSV not found for this table. Check Input Mapping and redeploy."
        : e?.message ?? "Unknown error";
    res.status(500).json({ ok: false, message: msg });
  }
}

export async function schemaTableHandler(req, res) {
  try {
    const def = getDef(req.params.key);
    if (!def) return res.status(404).json({ ok: false, message: "Unknown table key" });

    const { tablePath, rows } = await readCsvCached(def);
    const sample = rows.slice(0, 200);
    const cols = sample.length ? Object.keys(sample[0]) : [];

    const schema = cols.map((col) => {
      const values = sample.map((r) => r[col]);
      return { name: col, type: inferType(values) };
    });

    const numericColumns = schema.filter((c) => c.type === "number").map((c) => c.name);
    const candidateDimensions = schema
      .filter((c) => c.type === "string" || c.type === "date" || c.type === "boolean")
      .map((c) => c.name);

    res.status(200).json({
      ok: true,
      table: def,
      tablePath,
      totalRows: rows.length,
      columns: schema,
      suggestions: {
        groupBy: candidateDimensions.slice(0, 8),
        metrics: numericColumns.slice(0, 8),
      },
    });
  } catch (e) {
    const msg =
      e?.code === "ENOENT"
        ? "Input-mapped CSV not found for this table. Check Input Mapping and redeploy."
        : e?.message ?? "Unknown error";
    res.status(500).json({ ok: false, message: msg });
  }
}

export async function aggregateTableHandler(req, res) {
  try {
    const def = getDef(req.params.key);
    if (!def) return res.status(404).json({ ok: false, message: "Unknown table key" });

    const groupBy = String(req.query.groupBy ?? "").trim();
    const metric = String(req.query.metric ?? "").trim();
    const op = String(req.query.op ?? "sum").trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit ?? "30", 10) || 30));

    if (!groupBy || !metric) {
      return res.status(400).json({ ok: false, message: "Provide groupBy and metric query params" });
    }
    if (!["sum", "avg", "count"].includes(op)) {
      return res.status(400).json({ ok: false, message: "op must be sum|avg|count" });
    }

    const { tablePath, rows } = await readCsvCached(def);
    if (!rows.length) return res.status(200).json({ ok: true, table: def, tablePath, data: [] });

    if (!(groupBy in rows[0]) || !(metric in rows[0])) {
      return res.status(400).json({ ok: false, message: "Unknown groupBy or metric column name" });
    }

    const buckets = new Map(); // group -> {sum,count}
    for (const r of rows) {
      const g = String(r[groupBy] ?? "").trim() || "(blank)";
      const cur = buckets.get(g) ?? { sum: 0, count: 0, rows: 0 };
      cur.rows += 1;

      if (op === "count") {
        cur.count += 1;
      } else {
        const n = toNumber(r[metric]);
        if (n !== null) {
          cur.sum += n;
          cur.count += 1;
        }
      }

      buckets.set(g, cur);
    }

    const data = [...buckets.entries()].map(([key, v]) => {
      const value = op === "avg" ? (v.count ? v.sum / v.count : null) : op === "sum" ? v.sum : v.count;
      return { key, value, rows: v.rows };
    });
    data.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

    res.status(200).json({ ok: true, table: def, tablePath, groupBy, metric, op, data: data.slice(0, limit) });
  } catch (e) {
    const msg =
      e?.code === "ENOENT"
        ? "Input-mapped CSV not found for this table. Check Input Mapping and redeploy."
        : e?.message ?? "Unknown error";
    res.status(500).json({ ok: false, message: msg });
  }
}

