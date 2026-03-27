function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function streamHandler(req, res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.flushHeaders?.();

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  for (let i = 1; i <= 20; i += 1) {
    if (closed) return;
    res.write(`data: ${JSON.stringify({ i, ts: new Date().toISOString() })}\n\n`);
    await sleep(500);
  }

  res.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  res.end();
}

