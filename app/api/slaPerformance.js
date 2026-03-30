import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

function baseDataDir() {
  return process.env.KBC_DATADIR ? path.join(process.env.KBC_DATADIR) : "/data";
}

const CACHE = {
  tablePath: null,
  mtimeMs: null,
  rows: null,
};

function asNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replaceAll(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function readCsvCached(filePath) {
  const st = await fs.stat(filePath);
  if (CACHE.rows && CACHE.tablePath === filePath && CACHE.mtimeMs === st.mtimeMs) return CACHE.rows;

  const csv = await fs.readFile(filePath, "utf8");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });

  CACHE.tablePath = filePath;
  CACHE.mtimeMs = st.mtimeMs;
  CACHE.rows = rows;
  return rows;
}

function pct(met, breached) {
  const denom = met + breached;
  return denom ? (met / denom) * 100 : null;
}

export async function slaPerformanceHandler(req, res) {
  try {
    const tablePath = path.join(baseDataDir(), "in", "tables", "client_sla_summary.csv");
    const rows = await readCsvCached(tablePath);

    const tierFilter = String(req.query.supportTier ?? "").trim();

    const filtered = tierFilter
      ? rows.filter((r) => String(r.support_tier ?? "").trim() === tierFilter)
      : rows;

    const tiers = [...new Set(rows.map((r) => String(r.support_tier ?? "").trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );

    const orgs = filtered.map((r) => {
      const org = String(r.organization_name ?? "").trim() || "(unknown)";
      const supportTier = String(r.support_tier ?? "").trim() || null;

      const totalTickets = asNumber(r.total_tickets) ?? 0;

      const frMet = asNumber(r.first_response_sla_met_count) ?? 0;
      const frBreached = asNumber(r.first_response_sla_breached_count) ?? 0;
      const resMet = asNumber(r.resolution_sla_met_count) ?? 0;
      const resBreached = asNumber(r.resolution_sla_breached_count) ?? 0;

      const frPct = asNumber(r.first_response_sla_compliance_pct) ?? pct(frMet, frBreached);
      const resPct = asNumber(r.resolution_sla_compliance_pct) ?? pct(resMet, resBreached);

      const criticalBreaches = asNumber(r.critical_sla_breaches) ?? 0;
      const highBreaches = asNumber(r.high_sla_breaches) ?? 0;

      return {
        organization: org,
        supportTier,
        totalTickets,
        firstResponse: { met: frMet, breached: frBreached, pct: frPct },
        resolution: { met: resMet, breached: resBreached, pct: resPct },
        severityBreaches: { critical: criticalBreaches, high: highBreaches },
      };
    });

    const totals = orgs.reduce(
      (acc, o) => {
        acc.totalTickets += o.totalTickets;
        acc.frMet += o.firstResponse.met;
        acc.frBreached += o.firstResponse.breached;
        acc.resMet += o.resolution.met;
        acc.resBreached += o.resolution.breached;
        acc.critical += o.severityBreaches.critical;
        acc.high += o.severityBreaches.high;
        return acc;
      },
      { totalTickets: 0, frMet: 0, frBreached: 0, resMet: 0, resBreached: 0, critical: 0, high: 0 },
    );

    const overall = {
      totalOrganizations: orgs.length,
      totalTickets: totals.totalTickets,
      firstResponseSlaPct: pct(totals.frMet, totals.frBreached),
      resolutionSlaPct: pct(totals.resMet, totals.resBreached),
      totalBreaches: totals.frBreached + totals.resBreached,
      criticalBreaches: totals.critical,
      highBreaches: totals.high,
    };

    const topBreaches = [...orgs]
      .map((o) => ({
        organization: o.organization,
        supportTier: o.supportTier,
        totalTickets: o.totalTickets,
        totalBreaches: o.firstResponse.breached + o.resolution.breached,
        resolutionSlaPct: o.resolution.pct,
        firstResponseSlaPct: o.firstResponse.pct,
      }))
      .sort((a, b) => b.totalBreaches - a.totalBreaches || b.totalTickets - a.totalTickets);

    const lowestResolutionSla = [...orgs]
      .filter((o) => typeof o.resolution.pct === "number")
      .map((o) => ({
        organization: o.organization,
        supportTier: o.supportTier,
        totalTickets: o.totalTickets,
        resolutionSlaPct: o.resolution.pct,
        resolutionBreaches: o.resolution.breached,
      }))
      .sort((a, b) => a.resolutionSlaPct - b.resolutionSlaPct || b.resolutionBreaches - a.resolutionBreaches);

    res.status(200).json({
      ok: true,
      tablePath,
      supportTierFilter: tierFilter || null,
      availableSupportTiers: tiers,
      overall,
      topBreaches: topBreaches.slice(0, 15),
      lowestResolutionSla: lowestResolutionSla.slice(0, 15),
    });
  } catch (e) {
    const msg =
      e?.code === "ENOENT"
        ? "client_sla_summary.csv not found. Check Input Mapping destination filename."
        : e?.message ?? "Unknown error";
    res.status(500).json({ ok: false, message: msg });
  }
}

