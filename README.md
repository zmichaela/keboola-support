# Keboola Data App Support Starter (Node.js)

This is a minimal starter for deploying a Node.js web app to **Keboola Data Apps** using the `keboola/data-app-python-js` base image.

## Structure

```text
app/                          # your Node.js app (Express)
keboola-config/
  nginx/sites/default.conf    # Nginx on 8888 -> app on 3000 (+ SSE no-buffer)
  supervisord/services/app.conf
  setup.sh                    # runs on startup (installs deps)
```

## Local run

```bash
cd app
npm install
npm start
```

Open:
- `http://localhost:3000/`
- `http://localhost:3000/api/support/summary`

## Keboola specifics covered

- Nginx listens on **8888** and proxies to the app on **3000**
- `/` is handled with **ALL methods** (Keboola startup POST)
- Dashboard reads input-mapped table from `/data/in/tables/client_sla_summary.csv`

