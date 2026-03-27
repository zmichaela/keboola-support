import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

function baseDataDir() {
  return process.env.KBC_DATADIR ? path.join(process.env.KBC_DATADIR) : "/data";
}

function normalizeKey(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "_")
    .replaceAll(/[^a-z0-9_]/g, "");
}

function asNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replaceAll(",", "."));
  return Number.isFinite(n) ? n : null;
}

function pickColumn(cols, candidates) {
  for (const c of candidates) {
    const idx = cols.indexOf(c);
    if (idx >= 0) return c;
  }
  return null;
}

async function readCsv(filePath) {
  const csv = await fs.readFile(filePath, "utf8");
  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });
}

function toDayKey(v) {
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function extractSlaSeries(rows) {
  if (!rows.length) return new Map();
  const cols = Object.keys(rows[0]).map((c) => normalizeKey(c));
  const byNorm = new Map(Object.keys(rows[0]).map((c) => [normalizeKey(c), c]));

  const dateColN = pickColumn(cols, ["day", "date", "created_date", "created_at", "period", "timestamp"]);
  const pctColN = pickColumn(cols, [
    "sla_pct",
    "sla_percent",
    "sla_percentage",
    "percent_sla",
    "pct_sla",
    "resolution_sla_compliance_pct",
    "first_response_sla_compliance_pct",
  ]);
  const ticketsColN = pickColumn(cols, ["tickets", "ticket_count", "count", "total", "requests"]);
  const breachesColN = pickColumn(cols, ["breaches", "breach_count", "sla_breach_count", "violations"]);

  const dateCol = dateColN ? byNorm.get(dateColN) : null;
  const pctCol = pctColN ? byNorm.get(pctColN) : null;
  const ticketsCol = ticketsColN ? byNorm.get(ticketsColN) : null;
  const breachesCol = breachesColN ? byNorm.get(breachesColN) : null;

  const m = new Map(); // day -> {slaPctSum, slaPctN, tickets, breaches}
  for (const r of rows) {
    const day = dateCol ? toDayKey(r[dateCol]) : null;
    if (!day) continue;
    const cur = m.get(day) ?? { slaPctSum: 0, slaPctN: 0, tickets: 0, breaches: 0 };

    const p = pctCol ? asNumber(r[pctCol]) : null;
    if (p !== null) {
      cur.slaPctSum += p;
      cur.slaPctN += 1;
    }

    const t = ticketsCol ? asNumber(r[ticketsCol]) : null;
    if (t !== null) cur.tickets += t;

    const b = breachesCol ? asNumber(r[breachesCol]) : null;
    if (b !== null) cur.breaches += b;

    m.set(day, cur);
  }

  const out = new Map();
  for (const [day, v] of m.entries()) {
    const slaPct =
      v.slaPctN > 0 ? v.slaPctSum / v.slaPctN : v.tickets > 0 ? ((v.tickets - v.breaches) / v.tickets) * 100 : null;
    out.set(day, { slaPct });
  }
  return out;
}

function extractVolumeSeries(rows) {
  if (!rows.length) return new Map();
  const cols = Object.keys(rows[0]).map((c) => normalizeKey(c));
  const byNorm = new Map(Object.keys(rows[0]).map((c) => [normalizeKey(c), c]));

  const dateColN = pickColumn(cols, ["day", "date", "created_date", "created_at", "week", "period", "timestamp"]);
  const ticketsColN = pickColumn(cols, ["tickets", "ticket_count", "count", "total", "issues", "issue_count", "volume"]);

  const dateCol = dateColN ? byNorm.get(dateColN) : null;
  const ticketsCol = ticketsColN ? byNorm.get(ticketsColN) : null;

  const m = new Map(); // day -> tickets
  for (const r of rows) {
    const day = dateCol ? toDayKey(r[dateCol]) : null;
    if (!day) continue;
    const t = ticketsCol ? asNumber(r[ticketsCol]) : null;
    if (t === null) continue;
    m.set(day, (m.get(day) ?? 0) + t);
  }
  return m;
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function overviewTrendsHandler(_req, res) {
  try {
    const dailyPath = path.join(baseDataDir(), "in", "tables", "daily_trends.csv");
    const weeklyPath = path.join(baseDataDir(), "in", "tables", "weekly_trends.csv");

    const volumePath = (await exists(dailyPath)) ? dailyPath : weeklyPath;

    // SLA trend should come from a time-bucketed table (daily/weekly). client_sla_summary is per-organization.
    const trendRows = await readCsv(volumePath);
    const slaMap = extractSlaSeries(trendRows);
    const volMap = extractVolumeSeries(trendRows);

    const keys = [...new Set([...slaMap.keys(), ...volMap.keys()])].sort((a, b) => a.localeCompare(b));
    const last = keys.slice(-60);

    res.status(200).json({
      ok: true,
      sources: { trend: path.basename(volumePath) },
      labels: last,
      slaPct: last.map((k) => slaMap.get(k)?.slaPct ?? null),
      ticketVolume: last.map((k) => volMap.get(k) ?? null),
    });
  } catch (e) {
    const msg =
      e?.code === "ENOENT"
        ? "Trends source table not found. Check Input Mapping for client_sla_summary and daily_trends/weekly_trends, then redeploy."
        : e?.message ?? "Unknown error";
    res.status(500).json({ ok: false, message: msg });
  }
}

