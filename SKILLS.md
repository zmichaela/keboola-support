# Keboola App Structure

This repository follows a simple Python structure suitable for a Keboola app/component starter.

## Folder Layout

- `src/main.py` - entrypoint used by Docker/Keboola runtime.
- `src/keboola_app/` - application package.
  - `config.py` - configuration loading and validation.
  - `runner.py` - app orchestration logic.
- `tests/` - automated tests.
- `data/` - local runtime data directory used by Keboola components.
  - `in/` - input mapping for local runs.
  - `out/` - output mapping for local runs.

## Core Conventions

- Keep runtime logic in `keboola_app/`, keep `main.py` thin.
- Read config from `KBC_DATADIR` (default `/data`).
- Fail fast on missing required parameters.
- Write deterministic JSON outputs into `data/out`.
- Add tests for config parsing and runner behavior.
