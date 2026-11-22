# Killcraft

A real-time strategy game in the browser in the spirit of Command & Conquer. Harvest ore for credits, keep your base powered, build from the sidebar, and destroy everything the enemy owns. Play the computer, or play other people online.

## Run it

1. `make setup` installs dependencies (Node 22+).
2. `make dev` starts the game server and the dev server, and opens the game at http://localhost:8000. Use `make dev PORT=9000` for another port (the game server uses `SERVER_PORT`, default 8081).

Other targets: `make test` (type-check, lint, and every test, including a live two-player match against the server), `make build` (production bundle in `dist/`), `make up` / `make down` (run the production image in Docker on `PORT`). `make help` lists everything.

## Play online

Click **Play Online**, pick a name, then:

- **Quick match** pairs you with the next person who presses it.
- **Create game** lists your game in the lobby; anyone can click **Join**.

Each match runs on the server, which sends each player only what their side can see. If a player leaves or surrenders, the other wins.

To let people outside your network play, deploy the Docker image (`deploy/`) to any host that runs containers and keeps WebSockets open, such as Coolify, Fly.io or a VPS. It serves the game and the lobby on one port (8080 in the container), with `/health` and `/status` checks.

### Production: killcraft.kriogenx.com (Coolify)

The live game runs on Coolify from this repo's `main` branch:

- **Build pack:** Dockerfile, base directory `/`, Dockerfile location `/deploy/Dockerfile`
- **Port:** `8080` (exposed). No environment variables are required; the image sets `SERVER_PORT=8080` and `STATIC_DIR`.
- **Domain:** `https://killcraft.kriogenx.com` (Coolify's proxy issues the certificate and passes WebSockets on `/ws` through)
- **Health check:** `GET /health`
- **DNS:** an `A` record for `killcraft` on kriogenx.com pointing at the Coolify server's IP.

## How to play

- **Economy:** credits are the only resource. Build a Power Plant, then a Refinery: it comes with a Harvester that collects ore and unloads it as credits. Each field holds about 14,000 credits and slowly regrows around its crystal rock; harvesters split a field between them instead of crowding one spot.
- **Power:** every structure but the Power Plant uses power. If you use more than you make, production runs at half speed and turrets fire slowly.
- **Building:** click a structure in the sidebar. Credits are spent as it builds, and it pauses if you run out. When it says READY, click it again and place it within 3 tiles of your base. Right-click a sidebar item to put it on hold, again to cancel (or use its × button).
- **Units:** click a unit in the sidebar to queue it at your Barracks or War Factory. Gunpowder and steel fight side by side:
  - Barracks: Rifleman, Rocket Soldier, and the medieval Swordsman (plate armor, beats riflemen up close), Crossbowman (armor-piercing bolts) and Knight (fast armored lancer).
  - War Factory: Scout Jeep, Battle Tank, Heavy Tank, Catapult (lobs boulders from long range, crushes buildings) and Harvester.
  - Rockets beat armor, rifles beat unarmored infantry, swords beat rifles, crossbows pierce plate, tanks beat almost everything.
- **Orders:** left-click or drag to select. Right-click to move, attack, send harvesters to ore or a refinery, or set a factory's rally point. Select a building to repair or sell it.
- **Touch:** tap to select; with something selected, tap elsewhere to give an order. Drag to scroll.
- **Surrender** (online): the button in the top bar, clicked twice.
- **Camera (3D):** `W` `A` `S` `D`, the arrow keys or the screen edge to pan; `Q`/`E` or middle-drag to turn; mouse wheel to zoom; `Shift`+wheel or middle-drag up and down to tilt. On touch screens: drag to pan, pinch to zoom, twist with two fingers to turn.
- **Keys:** `F` attack-move, `M` move, `X` stop, `R` repair, `Ctrl`+`1-9` assign a group and `1-9` recall it, `H` jump to base, `Space` jump to the last alert, `+`/`-` game speed, `P` pause. Selling has no key, so it can't happen by accident.

See [docs/project/architecture.md](docs/project/architecture.md) for how the code is organised.
