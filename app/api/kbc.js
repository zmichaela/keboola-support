function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`Missing required env var: ${name}`);
    err.statusCode = 500;
    throw err;
  }
  return v;
}

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function kbcFetch(path, { method = "GET", headers, body } = {}) {
  const KBC_URL = requireEnv("KBC_URL");
  const KBC_TOKEN = requireEnv("KBC_TOKEN");

  const url = joinUrl(KBC_URL, path);
  const res = await fetch(url, {
    method,
    headers: {
      "X-StorageApi-Token": KBC_TOKEN,
      ...(headers ?? {}),
    },
    body,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const err = new Error(`Keboola Storage API error ${res.status} on ${method} ${path}`);
    err.statusCode = res.status;
    err.details = payload;
    throw err;
  }

  return payload;
}

export async function configHandler(_req, res) {
  res.status(200).json({
    ok: true,
    hasKbcUrl: Boolean(process.env.KBC_URL),
    hasKbcToken: Boolean(process.env.KBC_TOKEN),
    kbcUrlHost: process.env.KBC_URL ? new URL(process.env.KBC_URL).host : null,
  });
}

export async function bucketsHandler(_req, res) {
  try {
    // Storage API: https://keboola.docs.apiary.io/#reference/buckets
    const data = await kbcFetch("/v2/storage/buckets");
    res.status(200).json(data);
  } catch (e) {
    res.status(e.statusCode ?? 500).json({ ok: false, message: e.message, details: e.details });
  }
}

export async function tableDetailHandler(req, res) {
  try {
    const tableId = req.params.tableId;
    if (!tableId) return res.status(400).json({ ok: false, message: "Missing tableId" });

    // Storage API: https://keboola.docs.apiary.io/#reference/tables
    const data = await kbcFetch(`/v2/storage/tables/${encodeURIComponent(tableId)}`);
    res.status(200).json(data);
  } catch (e) {
    res.status(e.statusCode ?? 500).json({ ok: false, message: e.message, details: e.details });
  }
}

