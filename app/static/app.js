const $ = (id) => document.getElementById(id);

const clientSelect = $("clientSelect");
const refreshBtn = $("refreshBtn");
const errorBox = $("errorBox");
const statusPill = $("statusPill");
const statusText = $("statusText");
const pageTitle = $("pageTitle");
const pageSubtitle = $("pageSubtitle");

let trendChart = null;
let tableChart = null;
let lastSummary = null;
let tablesIndex = null;
const schemaCache = new Map(); // key -> schema response
const TABLE_ROUTES = {
  "client-performance": "client_performance",
  "agent-performance": "agent_performance",
  "priority-severity": "priority_severity_analysis",
};

const fmtInt = (n) => (n === null || n === undefined ? "—" : new Intl.NumberFormat().format(n));
const fmtPct = (n) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);

function prettyName(name) {
  const s = String(name ?? "").trim();
  if (!s) return "";
  const cleaned = s.replaceAll("_", " ").replaceAll(/\s+/g, " ").trim();
  return cleaned
    .split(" ")
    .map((w) => {
      const up = w.toUpperCase();
      if (["SLA", "ID", "URL", "API"].includes(up)) return up;
      if (/^\d+$/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function prettyOp(op) {
  const o = String(op ?? "").toLowerCase();
  if (o === "sum") return "Total";
  if (o === "avg") return "Average";
  if (o === "count") return "Count";
  return prettyName(op);
}

function setStatus(kind, text) {
  statusText.textContent = text;
  statusPill.classList.remove("warn", "bad");
  if (kind === "warn") statusPill.classList.add("warn");
  if (kind === "bad") statusPill.classList.add("bad");
}

function showError(msg) {
  errorBox.style.display = "block";
  errorBox.textContent = msg;
  setStatus("bad", "Error");
}

function clearError() {
  errorBox.style.display = "none";
  errorBox.textContent = "";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fillClientSelect(allClients, selected) {
  const current = clientSelect.value;
  clientSelect.innerHTML = `<option value="">All clients</option>`;
  for (const c of allClients) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    clientSelect.appendChild(opt);
  }
  clientSelect.value = selected ?? current ?? "";
}

function renderClients(byClient) {
  const tbody = $("clientsTable");
  tbody.innerHTML = "";
  for (const r of byClient || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.client)}</td>
      <td>${fmtInt(r.tickets)}</td>
      <td>${fmtInt(r.breaches)}</td>
      <td>${fmtPct(r.slaPct)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderPreview(rows, headId, bodyId) {
  const head = $(headId);
  const body = $(bodyId);
  head.innerHTML = "";
  body.innerHTML = "";
  if (!rows || !rows.length) return;

  const cols = Object.keys(rows[0]);
  const trh = document.createElement("tr");
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c;
    trh.appendChild(th);
  }
  head.appendChild(trh);

  for (const r of rows) {
    const tr = document.createElement("tr");
    for (const c of cols) {
      const td = document.createElement("td");
      td.textContent = String(r[c] ?? "");
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

async function waitForChart() {
  for (let i = 0; i < 40; i += 1) {
    if (window.Chart) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function shortenLabel(s, max = 28) {
  const str = String(s ?? "");
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

async function renderTrend(trend) {
  const fb = $("trendFallback");
  if (fb) fb.style.display = "flex";
  const ok = await waitForChart();
  if (!ok) {
    if (fb) fb.textContent = "Chart unavailable (Chart.js did not load).";
    return;
  }

  const labels = (trend || []).map((x) => x.day || "");
  const data = (trend || []).map((x) => x.slaPct);
  const tickets = (trend || []).map((x) => x.tickets);

  const canvas = $("trendChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  trendChart?.destroy?.();
  trendChart = new window.Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "SLA %",
          data,
          borderColor: "rgba(59,130,246,0.95)",
          backgroundColor: "rgba(59,130,246,0.16)",
          tension: 0.35,
          fill: true,
          pointRadius: 2,
        },
        {
          type: "bar",
          label: "Tickets",
          data: tickets,
          borderColor: "rgba(29,78,216,0.85)",
          backgroundColor: "rgba(29,78,216,0.22)",
          yAxisID: "y2",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "rgba(229,231,235,0.85)" } },
        tooltip: { mode: "index", intersect: false },
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          ticks: {
            color: "rgba(229,231,235,0.6)",
            maxRotation: 0,
            autoSkip: true,
            callback: function (value) {
              return shortenLabel(this.getLabelForValue(value), 18);
            },
          },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
        y: {
          ticks: { color: "rgba(229,231,235,0.6)", callback: (v) => `${v}%` },
          grid: { color: "rgba(255,255,255,0.06)" },
          suggestedMin: 0,
          suggestedMax: 100,
        },
        y2: {
          position: "right",
          ticks: { color: "rgba(229,231,235,0.6)" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
  if (fb) fb.style.display = "none";
}

async function renderOverviewTrends() {
  const r = await fetch("/api/overview/trends");
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || !data.ok) {
    showError(data?.message || "Trend data unavailable.");
    return;
  }

  const labels = (data.labels || []).map((x) => String(x ?? ""));
  const slaPct = (data.slaPct || []).map((x) => (typeof x === "number" ? x : null));
  const vol = (data.ticketVolume || []).map((x) => (typeof x === "number" ? x : null));

  const slaBody = $("slaTrendTable");
  const volBody = $("volumeTrendTable");
  if (!slaBody || !volBody) return;

  slaBody.innerHTML = "";
  volBody.innerHTML = "";

  for (let i = 0; i < labels.length; i += 1) {
    const bucket = labels[i];

    const tr1 = document.createElement("tr");
    tr1.innerHTML = `<td>${escapeHtml(bucket)}</td><td>${fmtPct(slaPct[i])}</td>`;
    slaBody.appendChild(tr1);

    const tr2 = document.createElement("tr");
    tr2.innerHTML = `<td>${escapeHtml(bucket)}</td><td>${fmtInt(vol[i])}</td>`;
    volBody.appendChild(tr2);
  }
}

async function fetchSummary() {
  clearError();
  setStatus("warn", "Loading…");

  const client = clientSelect.value;
  const url = client ? `/api/support/summary?client=${encodeURIComponent(client)}` : "/api/support/summary";

  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || !data.ok) {
    showError(data?.message || `Failed to load ${url}`);
    return null;
  }

  setStatus("ok", "Live");
  return data;
}

async function renderSlaPage() {
  const data = await fetchSummary();
  if (!data) return;
  lastSummary = data;

  $("kpiRows").textContent = fmtInt(data.kpis?.rows);
  $("kpiTickets").textContent = fmtInt(Math.round(data.kpis?.totalTickets ?? 0));
  $("kpiBreaches").textContent = fmtInt(Math.round(data.kpis?.totalBreaches ?? 0));
  $("kpiSla").textContent = fmtPct(data.kpis?.overallSlaPct);
  $("kpiSlaSub").textContent = data.clientFilter ? `Filtered by client: ${data.clientFilter}` : "All clients";

  const allClients = (data.byClient || []).map((x) => x.client).filter(Boolean);
  fillClientSelect(allClients, data.clientFilter || "");

  renderClients(data.byClient);
}

async function fetchTablesIndex() {
  const r = await fetch("/api/tables");
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || !data.ok) throw new Error(data?.message || "Failed to load /api/tables");
  return data;
}

function parseRoute() {
  const h = window.location.hash || "#/overview";
  const m = h.match(/^#\/([^?#]+)/);
  const raw = (m?.[1] ?? "overview").replace(/\/+$/, "");
  const parts = raw.split("/").filter(Boolean);
  return { raw, parts };
}

function setActiveNav(routeKey) {
  document.querySelectorAll("a[data-route]").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-route") === routeKey);
  });
}

function showPage(id) {
  document.querySelectorAll("[data-page]").forEach((el) => (el.style.display = "none"));
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = id === "page-overview" ? "" : "block";
}

function fillSupportTierSelect(selectEl, tiers, selected) {
  selectEl.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All tiers";
  selectEl.appendChild(all);
  for (const t of tiers || []) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    selectEl.appendChild(opt);
  }
  selectEl.value = selected ?? "";
}

async function renderSlaPerformancePage() {
  clearError();
  setStatus("warn", "Loading…");

  const tierSelect = $("supportTierSelect");
  const refresh = $("slaPerfRefreshBtn");
  if (!tierSelect || !refresh) return;

  const tier = String(tierSelect.value ?? "").trim();
  const url = tier ? `/api/sla/performance?supportTier=${encodeURIComponent(tier)}` : "/api/sla/performance";

  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || !data.ok) {
    showError(data?.message || "Failed to load SLA performance.");
    return;
  }

  fillSupportTierSelect(tierSelect, data.availableSupportTiers, data.supportTierFilter || "");

  $("kpiResSla").textContent = fmtPct(data.overall?.resolutionSlaPct);
  $("kpiFrSla").textContent = fmtPct(data.overall?.firstResponseSlaPct);
  $("kpiPerfTickets").textContent = fmtInt(data.overall?.totalTickets);
  $("kpiPerfBreaches").textContent = fmtInt(data.overall?.totalBreaches);

  const topBody = $("topBreachesTable");
  const lowBody = $("lowestResTable");
  topBody.innerHTML = "";
  lowBody.innerHTML = "";

  for (const row of data.topBreaches || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.organization)}</td>
      <td>${escapeHtml(row.supportTier || "")}</td>
      <td>${fmtInt(row.totalTickets)}</td>
      <td>${fmtInt(row.totalBreaches)}</td>
      <td>${fmtPct(row.resolutionSlaPct)}</td>
    `;
    topBody.appendChild(tr);
  }

  for (const row of data.lowestResolutionSla || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.organization)}</td>
      <td>${escapeHtml(row.supportTier || "")}</td>
      <td>${fmtPct(row.resolutionSlaPct)}</td>
      <td>${fmtInt(row.resolutionBreaches)}</td>
    `;
    lowBody.appendChild(tr);
  }

  refresh.onclick = renderSlaPerformancePage;
  tierSelect.onchange = renderSlaPerformancePage;

  setStatus("ok", "Live");
}

async function getSchema(key) {
  const cached = schemaCache.get(key);
  if (cached) return cached;
  const r = await fetch(`/api/tables/${encodeURIComponent(key)}/schema`);
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || !data.ok) throw new Error(data?.message || "Failed to load schema");
  schemaCache.set(key, data);
  return data;
}

function fillSelect(el, values, preferred) {
  el.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = prettyName(v);
    el.appendChild(opt);
  }
  if (preferred && values.includes(preferred)) el.value = preferred;
}

function pickDefault(values, hints) {
  for (const h of hints) {
    const found = values.find((v) => String(v).toLowerCase() === h.toLowerCase());
    if (found) return found;
  }
  return values[0] ?? "";
}

const TABLE_DEFAULTS = {
  issues_enriched: { groupBy: "priority_name", metric: "issue_id", op: "count" },
  sla_compliance: { groupBy: "organization_name", metric: "resolution_sla_pct", op: "avg" },
  client_performance: { groupBy: "organization_name", metric: "resolution_rate_pct", op: "avg" },
  agent_performance: { groupBy: "agent_name", metric: "resolution_rate_pct", op: "avg" },
  priority_severity_analysis: { groupBy: "severity_level", metric: "resolution_rate_pct", op: "avg" },
};

function chartTitleText(op, metric, groupBy) {
  if (String(op).toLowerCase() === "count") return `Issue count by ${prettyName(groupBy)}`;
  return `${prettyOp(op)} ${prettyName(metric)} by ${prettyName(groupBy)}`;
}

async function renderTableChart({ labels, values, isTime, metric }) {
  const fb = $("tableFallback");
  if (fb) fb.style.display = "flex";
  const ok = await waitForChart();
  if (!ok) {
    if (fb) fb.textContent = "Chart unavailable (Chart.js did not load).";
    return;
  }
  const canvas = $("tableChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  tableChart?.destroy?.();

  const isPctMetric = String(metric ?? "").toLowerCase().includes("pct");

  tableChart = new window.Chart(ctx, {
    type: isTime ? "line" : "bar",
    data: {
      labels: labels.map((l) => shortenLabel(prettyName(l), 24)),
      datasets: [
        {
          label: "Value",
          data: values,
          borderColor: "rgba(59,130,246,0.95)",
          backgroundColor: isTime ? "rgba(59,130,246,0.16)" : "rgba(59,130,246,0.26)",
          tension: 0.35,
          fill: isTime,
          borderRadius: isTime ? 0 : 10,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: "index", intersect: false },
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          ticks: {
            color: "rgba(229,231,235,0.6)",
            maxRotation: 0,
            autoSkip: true,
            callback: function (value) {
              return shortenLabel(this.getLabelForValue(value), isTime ? 18 : 22);
            },
          },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
        y: {
          ticks: {
            color: "rgba(229,231,235,0.6)",
            callback: isPctMetric ? (v) => `${v}%` : undefined,
          },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
      },
    },
  });
  if (fb) fb.style.display = "none";
}

function renderAggTable(data) {
  const tbody = $("aggTable");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const r of data || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.key)}</td>
      <td>${r.value === null || r.value === undefined ? "—" : String(Math.round(r.value * 100) / 100)}</td>
      <td>${fmtInt(r.rows)}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function renderTablePage(key) {
  clearError();
  setStatus("warn", "Loading…");

  if (!tablesIndex) tablesIndex = await fetchTablesIndex();
  const def = (tablesIndex.tables || []).find((t) => t.key === key);
  $("tableTitle").textContent = def ? def.label : `Table: ${key}`;

  const schema = await getSchema(key);
  const groupByOptions = schema.suggestions?.groupBy ?? schema.columns?.map((c) => c.name) ?? [];
  const metricOptions = schema.suggestions?.metrics ?? schema.columns?.filter((c) => c.type === "number").map((c) => c.name) ?? [];

  const groupBySelect = $("groupBySelect");
  const metricSelect = $("metricSelect");
  const opSelect = $("opSelect");
  const applyBtn = $("applyTableBtn");

  const presets = TABLE_DEFAULTS[key] ?? {};
  const defaultGroupBy = pickDefault(
    groupByOptions,
    [presets.groupBy, "organization_name", "client", "agent_name", "priority_name", "severity_level", "status_name", "date", "day", "week"].filter(Boolean),
  );
  const defaultMetric = pickDefault(
    metricOptions,
    [presets.metric, "resolution_rate_pct", "resolution_sla_pct", "first_response_sla_pct", "total_tickets", "open_tickets", "avg_hours_to_resolution", "count"].filter(Boolean),
  );

  fillSelect(groupBySelect, groupByOptions, defaultGroupBy);
  fillSelect(metricSelect, metricOptions, defaultMetric);
  if (presets.op && ["sum", "avg", "count"].includes(presets.op)) opSelect.value = presets.op;

  const isTime =
    key === "daily_trends" ||
    key === "weekly_trends" ||
    (schema.columns || []).some((c) => c.name === groupBySelect.value && c.type === "date");
  $("chartTitle").textContent = chartTitleText(opSelect.value, metricSelect.value, groupBySelect.value);

  const load = async () => {
    try {
      clearError();
      setStatus("warn", "Loading…");

      $("chartTitle").textContent = chartTitleText(opSelect.value, metricSelect.value, groupBySelect.value);

      const aggUrl =
        `/api/tables/${encodeURIComponent(key)}/aggregate` +
        `?groupBy=${encodeURIComponent(groupBySelect.value)}` +
        `&metric=${encodeURIComponent(metricSelect.value)}` +
        `&op=${encodeURIComponent(opSelect.value)}` +
        `&order=${encodeURIComponent(isTime ? "key_asc" : "value_desc")}` +
        `&limit=30`;

      const [aggRes, prevRes] = await Promise.all([
        fetch(aggUrl).then((r) => r.json()),
        fetch(`/api/tables/${encodeURIComponent(key)}/preview?limit=25`).then((r) => r.json()),
      ]);

      if (!aggRes?.ok) throw new Error(aggRes?.message || "Failed to load aggregate");
      if (!prevRes?.ok) throw new Error(prevRes?.message || "Failed to load preview");

      renderAggTable(aggRes.data);
      const labels = (aggRes.data || []).map((x) => String(x.key ?? ""));
      const values = (aggRes.data || []).map((x) => (typeof x.value === "number" ? x.value : null));
      await renderTableChart({ labels, values, isTime, metric: metricSelect.value });
      renderPreview(prevRes.rows, "tablePreviewHead", "tablePreviewBody");

      setStatus("ok", "Live");
    } catch (e) {
      showError(e?.message ?? "Failed to load table");
    }
  };

  applyBtn.onclick = load;
  await load();
}

async function renderRoute() {
  const { parts } = parseRoute();
  const top = (parts[0] ?? "overview").toLowerCase();
  const mappedTableKey = TABLE_ROUTES[top];

  if (mappedTableKey) {
    setActiveNav(top);
    showPage("page-table");
    pageTitle.textContent = "Client servicing health";
    pageSubtitle.textContent = "Focused operational view from input-mapped support tables.";
    await renderTablePage(mappedTableKey);
    return;
  }

  if (top === "table") {
    const key = parts[1] ?? "";
    setActiveNav(`table/${key}`);
    showPage("page-table");

    pageTitle.textContent = "SLA dashboards";
    pageSubtitle.textContent = "Table-driven tab (input mapping).";
    await renderTablePage(key);
    return;
  }

  setActiveNav(top);

  if (top === "overview") {
    showPage("page-overview");
    pageTitle.textContent = "Client servicing health";
    pageSubtitle.innerHTML = `Executive overview powered by <code>client_sla_summary</code>`;
    await renderSlaPage();
    return;
  }

  if (top === "sla-performance") {
    showPage("page-sla-performance");
    pageTitle.textContent = "SLA performance";
    pageSubtitle.innerHTML = `Organization and tier-level SLA outcomes from <code>client_sla_summary</code>`;
    await renderSlaPerformancePage();
    return;
  }

  showPage("page-about");
  pageTitle.textContent = "About";
  pageSubtitle.textContent = "SLA dashboards across multiple tabs.";
}

refreshBtn.addEventListener("click", renderRoute);
clientSelect.addEventListener("change", renderRoute);
window.addEventListener("hashchange", renderRoute);

if (!window.location.hash) window.location.hash = "#/overview";
renderRoute();

