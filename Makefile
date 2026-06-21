# Cladewright — dev convenience targets.
# The GUI is the Vite dev server in frontend/. `make gui` runs it in the
# foreground; `make gui-up` backgrounds it (logs + pidfile) and `make gui-down`
# stops it. Run `make help` for the full list.

FRONTEND := frontend
RUN_DIR  := .run
PIDFILE  := $(RUN_DIR)/gui.pid
LOGFILE  := $(RUN_DIR)/gui.log
PORT     ?= 5173

# Backend dev stack (Postgres + Django API) — same DB as prod.
DC     := docker compose -f docker-compose.dev.yml
MANAGE := $(DC) exec web python manage.py
ASSET  ?= /data/out/mammalia.json   # path INSIDE the web container (./data is mounted)

# Asset-build pipeline (host venv with Braidworks; NOT in the serving image).
PVENV   := backend/.venv-pipeline
PPY     := $(PVENV)/bin/python
SCOPE   ?= class=Mammalia            # build_gamedata --scope (rank=value)
COLDP   ?= data/coldp_mammalia       # ColDP dump dir to build from
OUT     ?= data/out/mammalia.json    # asset JSON to write (host path)

.DEFAULT_GOAL := help

.PHONY: help gui gui-up gui-down gui-restart gui-logs gui-status install build \
        dev dev-down be-up be-up-build be-down be-logs be-shell migrate seed dbshell \
        wheels pipeline-venv build-asset col-dump

help: ## List available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install frontend dependencies
	cd $(FRONTEND) && npm install

gui: ## Run the GUI dev server in the foreground (Ctrl-C to stop)
	cd $(FRONTEND) && npm run dev -- --port $(PORT)

gui-up: ## Start the GUI dev server in the background (logs to $(LOGFILE))
	@mkdir -p $(RUN_DIR)
	@if [ -f $(PIDFILE) ] && kill -0 `cat $(PIDFILE)` 2>/dev/null; then \
		echo "GUI already running (pid `cat $(PIDFILE)`) — http://localhost:$(PORT)/"; \
	else \
		setsid sh -c 'cd $(FRONTEND) && exec npm run dev -- --port $(PORT)' > $(LOGFILE) 2>&1 & \
		echo $$! > $(PIDFILE); \
		sleep 1; \
		echo "GUI started (pid `cat $(PIDFILE)`) — http://localhost:$(PORT)/  (logs: make gui-logs)"; \
	fi

# `setsid` puts the server in its own process group whose leader is the pidfile pid,
# so `kill -- -PID` (negative = group) takes down npm AND its vite child together.
gui-down: ## Stop the background GUI dev server
	@if [ -f $(PIDFILE) ] && kill -0 `cat $(PIDFILE)` 2>/dev/null; then \
		kill -- -`cat $(PIDFILE)` 2>/dev/null || kill `cat $(PIDFILE)`; \
		echo "GUI stopped (pid `cat $(PIDFILE)`)."; \
	else \
		pkill -f "vite.*--port $(PORT)" 2>/dev/null && echo "GUI stopped (by port match)." \
			|| echo "GUI not running."; \
	fi
	@rm -f $(PIDFILE)

gui-restart: gui-down gui-up ## Restart the background GUI dev server

gui-logs: ## Tail the background GUI dev server logs
	@tail -f $(LOGFILE)

gui-status: ## Show whether the background GUI is running
	@if [ -f $(PIDFILE) ] && kill -0 `cat $(PIDFILE)` 2>/dev/null; then \
		echo "GUI running (pid `cat $(PIDFILE)`) — http://localhost:$(PORT)/"; \
	else \
		echo "GUI not running."; \
	fi

build: ## Production build of the GUI
	cd $(FRONTEND) && npm run build

# ── Full dev loop: Postgres + Django API (docker) + Vite GUI (host) ──────────────
dev: be-up-build gui-up ## Bring up the whole dev stack (db + API + GUI)
	@echo ""
	@echo "  GUI:  http://localhost:$(PORT)/        (Vite, proxies /api -> :8000)"
	@echo "  API:  http://localhost:8000/api/gamedata/current/"
	@echo "  First run? seed the DB:  make seed"

dev-down: gui-down be-down ## Tear the whole dev stack down

be-up: ## Start the backend stack (db + web) detached
	$(DC) up -d

be-up-build: ## Start the backend stack, rebuilding the web image first
	$(DC) up -d --build

be-down: ## Stop the backend stack
	$(DC) down

be-logs: ## Tail the web (Django) logs
	$(DC) logs -f web

be-shell: ## Open a shell in the web container
	$(DC) exec web /bin/bash

migrate: ## Run Django migrations in the web container
	$(MANAGE) migrate

seed: ## Load the built asset into Postgres (ASSET=$(ASSET)) and mark it current
	$(MANAGE) load_gamedata --asset $(ASSET) --current

# ── Asset build pipeline (host venv + Braidworks enrichment) ─────────────────────
col-dump: ## Download the CoL bulk ColDP archive (~1GB) into data/coldp_col, for any-scope builds
	backend/scripts/fetch_col_dump.sh

wheels: ## Rebuild the vendored Braidworks wheels from the sibling repo
	backend/scripts/build_braidworks_wheels.sh

pipeline-venv: ## Create the build venv and install serving deps + Braidworks wheels
	cd backend && uv venv .venv-pipeline --python 3.12 \
	  && uv pip install --python .venv-pipeline -r requirements-pipeline.txt

build-asset: ## Build an asset with Braidworks (SCOPE=, COLDP=, OUT=); then `make seed ASSET=/<OUT>`
	cd backend && $(CURDIR)/$(PPY) manage.py build_gamedata \
	  --coldp-dir $(CURDIR)/$(COLDP) --scope "$(SCOPE)" \
	  --out $(CURDIR)/$(OUT) --enrich braidworks --include-extinct

dbshell: ## Open a psql shell on the dev database
	$(MANAGE) dbshell
