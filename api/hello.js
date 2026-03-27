export function helloHandler(req, res) {
  res.status(200).json({
    ok: true,
    method: req.method,
    message: "Hello from Keboola Data App (Node.js).",
  });
}

