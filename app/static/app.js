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

const fmtInt = (n) => (n === null || n === undefined ? "—" : new Intl.NumberFormat().format(n));
const fmtPct = (n) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);

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

async function renderTrend(trend) {
  const ok = await waitForChart();
  if (!ok) return;

  const labels = (trend || []).map((x) => x.day || "");
  const data = (trend || []).map((x) => x.slaPct);
  const breaches = (trend || []).map((x) => x.breaches);

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
          borderColor: "rgba(34,197,94,0.95)",
          backgroundColor: "rgba(34,197,94,0.15)",
          tension: 0.35,
          fill: true,
          pointRadius: 2,
        },
        {
          label: "Breaches",
          data: breaches,
          borderColor: "rgba(239,68,68,0.85)",
          backgroundColor: "rgba(239,68,68,0.10)",
          tension: 0.35,
          yAxisID: "y2",
          pointRadius: 1,
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
          ticks: { color: "rgba(229,231,235,0.6)", maxRotation: 0, autoSkip: true },
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
  renderPreview(data.preview, "previewHead", "previewBody");
  await renderTrend(data.trend);
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
    opt.textContent = v;
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

async function renderTableChart({ labels, values, isTime }) {
  const ok = await waitForChart();
  if (!ok) return;
  const canvas = $("tableChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  tableChart?.destroy?.();

  tableChart = new window.Chart(ctx, {
    type: isTime ? "line" : "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Value",
          data: values,
          borderColor: "rgba(124,58,237,0.95)",
          backgroundColor: isTime ? "rgba(124,58,237,0.18)" : "rgba(124,58,237,0.30)",
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
          ticks: { color: "rgba(229,231,235,0.6)", maxRotation: 0, autoSkip: true },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
        y: {
          ticks: { color: "rgba(229,231,235,0.6)" },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
      },
    },
  });
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

  const defaultGroupBy = pickDefault(groupByOptions, ["date", "day", "week", "month", "client", "agent", "priority", "severity"]);
  const defaultMetric = pickDefault(metricOptions, ["breaches", "breach_count", "tickets", "ticket_count", "count", "sla_pct", "sla_percent"]);

  fillSelect(groupBySelect, groupByOptions, defaultGroupBy);
  fillSelect(metricSelect, metricOptions, defaultMetric);

  const isTime =
    key === "daily_trends" ||
    key === "weekly_trends" ||
    (schema.columns || []).some((c) => c.name === groupBySelect.value && c.type === "date");
  $("chartTitle").textContent = `${opSelect.value}(${metricSelect.value}) by ${groupBySelect.value}`;

  const load = async () => {
    try {
      clearError();
      setStatus("warn", "Loading…");

      $("chartTitle").textContent = `${opSelect.value}(${metricSelect.value}) by ${groupBySelect.value}`;

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
      await renderTableChart({ labels, values, isTime });
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
    pageTitle.textContent = "Support performance";
    pageSubtitle.innerHTML = `Powered by input mapping table <code>client_sla_summary</code>`;
    await renderSlaPage();
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

