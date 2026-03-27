import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

const DEFAULT_TABLE_PATH = "/data/in/tables/client_sla_summary.csv";

const cache = {
  tablePath: null,
  mtimeMs: null,
  rows: null,
};

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

function asBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "t", "yes", "y", "1", "ok", "met", "pass"].includes(s)) return true;
  if (["false", "f", "no", "n", "0", "breach", "failed", "fail"].includes(s)) return false;
  return null;
}

function pickColumn(cols, candidates) {
  for (const c of candidates) {
    const idx = cols.indexOf(c);
    if (idx >= 0) return c;
  }
  return null;
}

function detectColumns(rows) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const ncols = cols.map((c) => normalizeKey(c));

  const byNorm = new Map();
  for (let i = 0; i < cols.length; i += 1) byNorm.set(ncols[i], cols[i]);

  const resolve = (cands) => {
    const foundNorm = pickColumn(ncols, cands);
    return foundNorm ? byNorm.get(foundNorm) : null;
  };

  return {
    client: resolve([
      "client",
      "client_name",
      "customer",
      "account",
      "organization",
      "organization_name",
      "org",
      "company",
    ]),
    date: resolve(["date", "day", "created_date", "created_at", "month", "period", "timestamp"]),
    slaMet: resolve(["sla_met", "sla_ok", "met_sla", "sla_pass", "within_sla"]),
    breached: resolve(["sla_breached", "breached", "breach", "sla_fail", "outside_sla"]),
    total: resolve(["total", "tickets", "ticket_count", "total_tickets", "count", "requests"]),
    breaches: resolve([
      "breaches",
      "breach_count",
      "sla_breach_count",
      "violations",
      "resolution_sla_breached_count",
      "first_response_sla_breached_count",
    ]),
    slaPct: resolve([
      "sla_pct",
      "sla_percent",
      "sla_percentage",
      "percent_sla",
      "pct_sla",
      "resolution_sla_compliance_pct",
      "first_response_sla_compliance_pct",
    ]),
    resolutionHrs: resolve([
      "avg_resolution_hours",
      "avg_resolution_hrs",
      "resolution_hours",
      "resolution_hrs",
      "avg_resolution_time_hours",
    ]),
    firstResponseHrs: resolve([
      "avg_first_response_hours",
      "avg_first_response_hrs",
      "first_response_hours",
      "first_response_hrs",
      "avg_first_response_time_hours",
    ]),
  };
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = String(r[key] ?? "").trim() || "(unknown)";
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
}

function safeDateBucket(v) {
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) return null;
  // bucket by day in ISO yyyy-mm-dd
  return d.toISOString().slice(0, 10);
}

function computeSummary(rows) {
  const cols = detectColumns(rows);

  // KPI helpers
  const totalFromRow = (r) => (cols.total ? asNumber(r[cols.total]) : null);
  const breachesFromRow = (r) => (cols.breaches ? asNumber(r[cols.breaches]) : null);
  const slaPctFromRow = (r) => (cols.slaPct ? asNumber(r[cols.slaPct]) : null);

  let totalTickets = 0;
  let totalBreaches = 0;
  let ticketsKnown = 0;
  let breachesKnown = 0;
  let slaPctSum = 0;
  let slaPctKnown = 0;

  // Support for schemas that have separate first_response_* and resolution_* counts.
  const hasFirstResponseBreached = rows.length && "first_response_sla_breached_count" in rows[0];
  const hasResolutionBreached = rows.length && "resolution_sla_breached_count" in rows[0];
  const hasFirstResponseMet = rows.length && "first_response_sla_met_count" in rows[0];
  const hasResolutionMet = rows.length && "resolution_sla_met_count" in rows[0];

  for (const r of rows) {
    const t = totalFromRow(r);
    if (t !== null) {
      totalTickets += t;
      ticketsKnown += 1;
    } else {
      totalTickets += 1; // fallback: count rows as tickets
    }

    // Breaches
    if (hasFirstResponseBreached || hasResolutionBreached) {
      const frB = hasFirstResponseBreached ? asNumber(r.first_response_sla_breached_count) ?? 0 : 0;
      const rsB = hasResolutionBreached ? asNumber(r.resolution_sla_breached_count) ?? 0 : 0;
      totalBreaches += frB + rsB;
      breachesKnown += 1;
    } else {
      const b = breachesFromRow(r);
      if (b !== null) {
        totalBreaches += b;
        breachesKnown += 1;
      } else if (cols.breached) {
        const breached = asBool(r[cols.breached]);
        if (breached === true) totalBreaches += 1;
      } else if (cols.slaMet) {
        const met = asBool(r[cols.slaMet]);
        if (met === false) totalBreaches += 1;
      }
    }

    const p = slaPctFromRow(r);
    if (p !== null) {
      slaPctSum += p;
      slaPctKnown += 1;
    }
  }

  const overallSlaPct = (() => {
    if (slaPctKnown > 0) return slaPctSum / slaPctKnown;
    if (hasFirstResponseMet || hasResolutionMet || hasFirstResponseBreached || hasResolutionBreached) {
      // Weighted compliance based on met vs breached counts (if available).
      let met = 0;
      let breached = 0;
      for (const r of rows) {
        if (hasFirstResponseMet) met += asNumber(r.first_response_sla_met_count) ?? 0;
        if (hasResolutionMet) met += asNumber(r.resolution_sla_met_count) ?? 0;
        if (hasFirstResponseBreached) breached += asNumber(r.first_response_sla_breached_count) ?? 0;
        if (hasResolutionBreached) breached += asNumber(r.resolution_sla_breached_count) ?? 0;
      }
      const denom = met + breached;
      return denom ? (met / denom) * 100 : null;
    }
    return totalTickets > 0 ? ((totalTickets - totalBreaches) / totalTickets) * 100 : null;
  })();

  // Client breakdown
  const byClient = [];
  if (cols.client) {
    const g = groupBy(rows, cols.client);
    for (const [client, cr] of g.entries()) {
      const t = cr.reduce((acc, r) => acc + (totalFromRow(r) ?? 1), 0);
      const b = cr.reduce((acc, r) => {
        const bb = breachesFromRow(r);
        if (bb !== null) return acc + bb;
        if (cols.breached) return acc + (asBool(r[cols.breached]) === true ? 1 : 0);
        if (cols.slaMet) return acc + (asBool(r[cols.slaMet]) === false ? 1 : 0);
        return acc;
      }, 0);

      const pKnown = cr.map(slaPctFromRow).filter((x) => x !== null);
      const p = pKnown.length ? pKnown.reduce((a, x) => a + x, 0) / pKnown.length : ((t - b) / t) * 100;

      byClient.push({ client, tickets: t, breaches: b, slaPct: p });
    }
    byClient.sort((a, b) => b.breaches - a.breaches || a.client.localeCompare(b.client));
  }

  // Trend by date (optional)
  const trend = [];
  if (cols.date) {
    const buckets = new Map(); // date -> {tickets, breaches}
    for (const r of rows) {
      const day = safeDateBucket(r[cols.date]);
      if (!day) continue;
      const cur = buckets.get(day) ?? { tickets: 0, breaches: 0 };
      cur.tickets += totalFromRow(r) ?? 1;
      const bb = breachesFromRow(r);
      if (bb !== null) cur.breaches += bb;
      else if (cols.breached) cur.breaches += asBool(r[cols.breached]) === true ? 1 : 0;
      else if (cols.slaMet) cur.breaches += asBool(r[cols.slaMet]) === false ? 1 : 0;
      buckets.set(day, cur);
    }
    for (const [day, v] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      trend.push({
        day,
        tickets: v.tickets,
        breaches: v.breaches,
        slaPct: v.tickets ? ((v.tickets - v.breaches) / v.tickets) * 100 : null,
      });
    }
  }

  return {
    tablePath: DEFAULT_TABLE_PATH,
    detected: cols,
    kpis: {
      rows: rows.length,
      totalTickets,
      totalBreaches,
      overallSlaPct,
    },
    byClient: byClient.slice(0, 12),
    trend: trend.slice(-60),
    preview: rows.slice(0, 25),
  };
}

async function readMappedCsv(filePath) {
  const st = await fs.stat(filePath);
  if (cache.rows && cache.tablePath === filePath && cache.mtimeMs === st.mtimeMs) {
    return cache.rows;
  }

  const csv = await fs.readFile(filePath, "utf8");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });

  cache.tablePath = filePath;
  cache.mtimeMs = st.mtimeMs;
  cache.rows = rows;
  return rows;
}

export async function supportSummaryHandler(req, res) {
  try {
    const tablePath = process.env.KBC_DATADIR
      ? path.join(process.env.KBC_DATADIR, "in", "tables", "client_sla_summary.csv")
      : DEFAULT_TABLE_PATH;

    const rows = await readMappedCsv(tablePath);

    const clientFilter = String(req.query.client ?? "").trim();
    const filtered =
      clientFilter && rows.length
        ? (() => {
            const cols = detectColumns(rows);
            if (!cols.client) return rows;
            return rows.filter((r) => String(r[cols.client] ?? "").trim() === clientFilter);
          })()
        : rows;

    res.status(200).json({ ok: true, ...computeSummary(filtered), clientFilter: clientFilter || null });
  } catch (e) {
    const msg = e?.code === "ENOENT"
      ? `Input-mapped table not found. Expected: /data/in/tables/client_sla_summary.csv (or $KBC_DATADIR/in/tables/client_sla_summary.csv).`
      : e?.message ?? "Unknown error";
    res.status(500).json({ ok: false, message: msg });
  }
}

