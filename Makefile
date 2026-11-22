# Killcraft: a browser RTS (Vite, TypeScript, SCSS) with a Node game server for online play.
# `make help` lists every target.

.DEFAULT_GOAL := help
PORT ?= 8000
SERVER_PORT ?= 8081
export PORT SERVER_PORT
COMPOSE := docker compose -f deploy/docker-compose.yml

.PHONY: all help setup dev up build running test lint clean down

##@ Help

all: help ## Alias for `make help`

help: ## List every make target, grouped by category
	@awk 'BEGIN { FS = ":.*## " } \
		/^##@ / { printf "\n%s\n", substr($$0, 5); next } \
		/^[a-zA-Z_-]+:.*## / { printf "  make %-10s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo "\n  PORT=9000 make dev   use another port (default $(PORT); game server on $(SERVER_PORT))\n"

##@ Develop

setup: ## Install dependencies
	npm install

node_modules: package.json
	npm install
	@touch node_modules

dev: node_modules ## Run the game server and the dev server with hot reload, and open the game
	@trap 'kill 0' EXIT; node --watch server/main.ts & npx vite --open

up: ## Build the production image and run it in Docker (attached), like production
	$(COMPOSE) down --remove-orphans
	$(COMPOSE) up --build

build: node_modules ## Type-check and build the production bundle into dist/
	npm run build

running: ## Check whether the game is being served on PORT
	@curl -fsS -o /dev/null http://localhost:$(PORT)/ && echo "Running on http://localhost:$(PORT)" || (echo "Not running on port $(PORT)"; exit 1)

##@ Quality

test: node_modules ## Type-check, lint and run every test (game engine, UI logic, server)
	npm run typecheck
	npm run lint
	npm test

lint: node_modules ## Lint all code
	npm run lint

##@ Clean up

down: ## Stop the Docker container started by `make up`
	$(COMPOSE) down --remove-orphans

clean: ## Remove build output
	rm -rf dist
