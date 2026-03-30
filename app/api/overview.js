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

function toDayKeyLoose(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Accept "YYYY-MM-DD" directly.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toWeekKey(v) {
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) return null;
  // ISO week bucket anchor (Monday) in UTC.
  const day = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() - (day - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function asBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "t", "yes", "y", "1"].includes(s)) return true;
  if (["false", "f", "no", "n", "0"].includes(s)) return false;
  return null;
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
  const ticketsColN = pickColumn(cols, [
    "tickets",
    "ticket_count",
    "tickets_created",
    "tickets_resolved",
    "count",
    "total",
    "issues",
    "issue_count",
    "volume",
  ]);

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

function extractFromSlaCompliance(rows, bucket = "week") {
  if (!rows.length) return { labels: [], slaPct: [], ticketVolume: [] };
  const cols = Object.keys(rows[0]).map((c) => normalizeKey(c));
  const byNorm = new Map(Object.keys(rows[0]).map((c) => [normalizeKey(c), c]));

  const createdColN = pickColumn(cols, ["created_at", "created_date", "created", "date"]);
  const frMetN = pickColumn(cols, ["first_response_sla_met"]);
  const resMetN = pickColumn(cols, ["resolution_sla_met"]);

  const createdCol = createdColN ? byNorm.get(createdColN) : null;
  const frMetCol = frMetN ? byNorm.get(frMetN) : null;
  const resMetCol = resMetN ? byNorm.get(resMetN) : null;

  if (!createdCol) return { labels: [], slaPct: [], ticketVolume: [] };

  const keyFn = bucket === "day" ? toDayKeyLoose : toWeekKey;
  const buckets = new Map(); // key -> {tickets, met, total}

  for (const r of rows) {
    const k = keyFn(r[createdCol]);
    if (!k) continue;
    const cur = buckets.get(k) ?? { tickets: 0, met: 0, total: 0 };
    cur.tickets += 1;

    const fr = frMetCol ? asBool(r[frMetCol]) : null;
    const rs = resMetCol ? asBool(r[resMetCol]) : null;

    // Prefer resolution SLA if present, else first response.
    const chosen = rs !== null ? rs : fr;
    if (chosen !== null) {
      cur.total += 1;
      if (chosen === true) cur.met += 1;
    }

    buckets.set(k, cur);
  }

  const labels = [...buckets.keys()].sort((a, b) => a.localeCompare(b)).slice(-60);
  return {
    labels,
    ticketVolume: labels.map((k) => buckets.get(k)?.tickets ?? null),
    slaPct: labels.map((k) => {
      const v = buckets.get(k);
      if (!v || !v.total) return null;
      return (v.met / v.total) * 100;
    }),
  };
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
    const compliancePath = path.join(baseDataDir(), "in", "tables", "sla_compliance.csv");

    // Pick the best available trend source:
    // 1) daily_trends (if has rows)
    // 2) weekly_trends (if has rows)
    // 3) sla_compliance (derive trend from created_at + sla_met)
    if (await exists(dailyPath)) {
      const rows = await readCsv(dailyPath);
      if (rows.length) {
        const slaMap = extractSlaSeries(rows);
        const volMap = extractVolumeSeries(rows);
        const keys = [...new Set([...slaMap.keys(), ...volMap.keys()])].sort((a, b) => a.localeCompare(b));
        const last = keys.slice(-60);
        return res.status(200).json({
          ok: true,
          sources: { trend: "daily_trends.csv" },
          labels: last,
          slaPct: last.map((k) => slaMap.get(k)?.slaPct ?? null),
          ticketVolume: last.map((k) => volMap.get(k) ?? null),
        });
      }
    }

    if (await exists(weeklyPath)) {
      const rows = await readCsv(weeklyPath);
      if (rows.length) {
        const slaMap = extractSlaSeries(rows);
        const volMap = extractVolumeSeries(rows);
        const keys = [...new Set([...slaMap.keys(), ...volMap.keys()])].sort((a, b) => a.localeCompare(b));
        const last = keys.slice(-60);
        return res.status(200).json({
          ok: true,
          sources: { trend: "weekly_trends.csv" },
          labels: last,
          slaPct: last.map((k) => slaMap.get(k)?.slaPct ?? null),
          ticketVolume: last.map((k) => volMap.get(k) ?? null),
        });
      }
    }

    if (await exists(compliancePath)) {
      const rows = await readCsv(compliancePath);
      if (rows.length) {
        const derived = extractFromSlaCompliance(rows, "week");
        return res.status(200).json({
          ok: true,
          sources: { trend: "sla_compliance.csv" },
          labels: derived.labels,
          slaPct: derived.slaPct,
          ticketVolume: derived.ticketVolume,
        });
      }
    }

    return res.status(500).json({
      ok: false,
      message:
        "No trend data available. Provide rows in daily_trends.csv or weekly_trends.csv, or map sla_compliance.csv to derive trends.",
    });
  } catch (e) {
    const msg =
      e?.code === "ENOENT"
        ? "Trends source table not found. Check Input Mapping for client_sla_summary and daily_trends/weekly_trends, then redeploy."
        : e?.message ?? "Unknown error";
    res.status(500).json({ ok: false, message: msg });
  }
}

