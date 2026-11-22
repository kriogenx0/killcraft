# Architecture

Killcraft is a single-page real-time strategy game modelled on Command & Conquer (ore, harvesters, power, sidebar production). Vite builds the TypeScript and SCSS frontend. A Node game server runs online matches and, in production, also serves the built frontend.

## Stack

- TypeScript (strict), Vite, SCSS (`sass-embedded`)
- Vitest for unit and simulation tests, ESLint with `typescript-eslint`
- three.js (WebGL) for the 3D battlefield: every unit and building is a procedural model built from boxes, cylinders and spheres in code, so there are no model or image files
- Canvas 2D for the terrain painting (used as the ground texture), the minimap, the sidebar icons and the health-bar overlay
- Node 24 game server (`server/`) using `ws`; it runs the TypeScript engine directly with Node's built-in type stripping, so engine code must stay erasable (`erasableSyntaxOnly`, `verbatimModuleSyntax`)
- Docker (`deploy/`): one container runs the server, which serves `dist/` plus the WebSocket lobby, with `/health` and `/status`

## Layout

```
src/
  main.ts                 entry: loads styles, mounts the game view
  data/                   static data, one file per entity (unit, building, weapon, era, ore, team, map)
  util/                   pure helpers (math, noise, canvas)
  game/                   the simulation; never touches the DOM (also runs on the server)
  net/                    protocol types, snapshot encoding/decoding, browser WebSocket client
  components/             shared UI components (ui-button, ui-bar, ui-chip, ui-modal, ...)
  styles/                 reset, theme tokens, typography and spacing scales
  views/game/             the game view: frame loop, sidebar, HUD, input, camera_rig (orbit math), keyboard layout
    render3d/             3D battlefield: scene + camera, world3d (ground, water, trees, ore, fog sheet),
                          models (procedural units/buildings), entities3d (sync, animation, picking), fx3d, overlay
    render/               2D canvas: terrain painting, minimap, and the icon art for the sidebar
  views/lobby/            the online lobby
server/
  main.ts                 starts the HTTP + WebSocket server (config.ts reads the environment)
  controllers/            http_controller (health, status, static files), socket_controller (messages, rate limits)
  services/               lobby_service (players, open games, quick match), match_service (one worker per match)
  workers/match_worker.ts runs one match's engine and posts per-team snapshots
deploy/                   Dockerfile, docker-compose.yml
```

## How a frame works

```
 input.ts ──orders──▶ game/order.ts ──▶ entity state (G)
                                          │
 game_view.ts frame loop ── fixed 1/60s steps ──▶ game/world.ts update()
                                          │        units, buildings, production queues,
                                          │        projectiles, separation, particles,
                                          │        ore regrowth, fog, AI
                                          ▼
                      render3d/ syncs a 3D model per entity and draws the scene with three.js
                      hud.ts / sidebar.ts reflect credits, power, selection and production in the DOM
```

- **Engine state** lives in `G` (`src/game/state.ts`). The engine reports events (fog changed, ore changed, alerts, errors) through `hooks`, which the view sets. Because the engine has no DOM dependency, `src/game/world.test.ts` plays whole computer-vs-computer matches in Node.
- **View state** (camera, selection, command mode, markers) lives in `V` (`src/views/game/view_state.ts`).
- The simulation runs at a fixed 60 steps per second, independent of frame rate, and catches per-entity errors so one bad unit can't freeze the game.

## Online play

```
 browser ──{k:'cmd', cmd}──▶ socket_controller ──▶ match_service ──▶ match_worker (engine, 60 steps/s)
 browser ◀──{k:'snap'} 10/s── socket_controller ◀── per-team snapshot ◀──┘
```

- Every player action is a `Command` (`src/game/command.ts`). Solo games apply it locally; online games send it to the server, which validates it with `parseCommand` and only lets a team order its own units.
- The server is authoritative. Each snapshot holds only what that team can see (`visibleTo`), plus its credits, production queues, shots and deaths it witnessed, and about once a second the ore map.
- The online client never simulates combat (`G.visualOnly`): it eases entities toward reported positions, replays shots as effects, and computes its own fog from its own units.
- The lobby (`lobby_service`) tracks everyone connected. Each client in the lobby gets its own view (`LobbyMsg`): the players online with their status (in the lobby, looking for a match, hosting, playing whom), open games, challenges sent to it, and the id of the game it hosts. Players start a match by quick match, by joining an open game, by opening a host's invite link (`?join=ID`), or by challenging a player directly (`invite` → `accept`/`decline`).
- Each match runs in a worker thread because the engine keeps module-level state; a thread gives each match a fresh copy. At most 40 matches run at once.

## Testing the page

The game view reads URL options so a headless browser can check it:
`?view=yaw,pitch,dist` camera angle (degrees) and distance (tiles), `?seed=N` map seed, `?auto` skip the title screen, `?demo` AI vs AI, `?online` open the lobby (`?online=quick` also joins quick match), `?join=ID` open the lobby and join that game (invite links), `?sim=S` simulate S seconds before the first frame, `?reveal` no fog, `?cam=x,y` centre on a tile, `?sel=type` select your units of that type, `?queue=a,b` start producing these, `?era=N` start your side in age N. The root element gets `data-errors="n"` if anything throws.
