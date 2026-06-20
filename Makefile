# Cladewright — dev convenience targets.
# The GUI is the Vite dev server in frontend/. `make gui` runs it in the
# foreground; `make gui-up` backgrounds it (logs + pidfile) and `make gui-down`
# stops it. Run `make help` for the full list.

FRONTEND := frontend
RUN_DIR  := .run
PIDFILE  := $(RUN_DIR)/gui.pid
LOGFILE  := $(RUN_DIR)/gui.log
PORT     ?= 5173

.DEFAULT_GOAL := help

.PHONY: help gui gui-up gui-down gui-restart gui-logs gui-status install build

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
