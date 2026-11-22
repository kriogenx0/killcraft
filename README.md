# Killcraft

A real-time strategy game in the browser in the spirit of Command & Conquer. Harvest ore, cut wood, pump oil, keep your base powered, build from the sidebar, and destroy everything the enemy owns. Play the computer, or play other people online.

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

- **Economy:** there are three resources, shown in the top bar.
  - **Ore:** build a Power Plant, then a Refinery: it comes with a Harvester that collects ore and unloads it there. Each field holds about 14,000 ore and slowly regrows around its crystal rock; harvesters split a field between them instead of crowding one spot.
  - **Wood:** a Lumber Mill cuts wood from the trees within 5 tiles of it, so place it by the woods (select it to see how many trees it reaches and how much it cuts). Each tree holds 150 wood; a cut-down tree slowly grows back, so a mill slows once its trees are bare. Every side starts with woods near its base.
  - **Oil:** from the World War age, an Oil Derrick pumps oil from a well (the black pools: one near each base, two in the middle). Wells never refill, so a derrick runs dry; select it to see how much is left.
  - **Salvage:** anything destroyed in battle leaves 30% of its ore price behind as ore on the ground (plus whatever a harvester was carrying), for either side's harvesters to collect.
  - **Aether (rare):** violet shards of a fallen star lie in two or three spots in the middle ground, glowing on the radar. Stand any unit beside a deposit, with no enemy unit there, to draw 2 Aether a second; each deposit holds 200 and never regrows. Finding Aether reveals hidden units, each a regular unit plus one trick: the **Wraith Knight** (Medieval, lance passes through armor), the **Hex Rifleman** (World War, shots slow the target) and **Phantom Jeep** (World War, unseen until it fires or an enemy comes within 2 tiles), and the **Starfall Tank** (Modern, a beam that tears through buildings). The **Aether Ward** research makes your buildings take 10% less damage.
  - Prices follow what a thing is made of and runs on: metal and stone cost ore, timber costs wood, and engines and rockets cost oil. A Knight's lance and a Crossbowman's bow take wood, a Catapult is mostly wood, and Jeeps, Tanks and Rocket Soldiers need oil. Aircraft too: a War Balloon is silk, wicker and a wood fire (ore and wood), a Biplane is a wood-and-canvas frame with an oil-burning engine (ore, wood and oil), and an Attack Helicopter is all metal and burns oil (ore and oil, no wood). Each cell in the sidebar shows its price.
- **Creatures of myth:** four lairs between the bases each hold a wild creature from Greek myth, picked per map from the **Centaur** (fast archer), **Minotaur** (axe brute that smashes buildings), **Cyclops** (hurls boulders at tanks and walls), **Hydra** (bites three foes at once and regrows its wounds), **Cerberus** (breathes fire over infantry), **Harpy**, **Pegasus** and **Griffin** (flyers). A wild creature attacks anything that comes close to its lair and can't be killed: beat it down to a quarter of its health and it kneels, then stand beside it with no enemy there for 5 seconds to capture it. Once a side has captured a kind, it can train more of them (flyers at the Airfield, the rest at the Barracks) for ore plus Aether. A kneeling creature nobody captures gets back up after 30 seconds. The computer sends hunting parties to capture them too.
- **Power:** every structure but the Power Plant uses power. If you use more than you make, production runs at half speed and turrets fire slowly.
- **Building:** click a structure in the sidebar. Resources are spent as it builds, and it pauses if you run out of any of them. When it says READY, click it again and place it within 3 tiles of your base. Right-click a sidebar item to put it on hold, again to cancel (or use its × button).
- **Ages:** every side starts in the Medieval age and advances by researching the next age at the Construction Yard (it appears at the end of the structure list, one age at a time, and builds alongside your structures). Older units stay available after you advance, and the top bar shows your current age. Your base grows up with each age: it starts primitive (a log palisade fort, a post mill, clay furnaces, a thatched roundhouse) in the Medieval age, is rebuilt in brick and iron in the World War age, and in concrete and steel in the Modern age. The sidebar pictures follow along.

  | Age | Research | Needs | Unlocks |
  | --- | --- | --- | --- |
  | Medieval | (start) | | Swordsman, Crossbowman, Knight, Catapult, Harvester, the Watchtower, the Lumber Mill, and every base structure but the Gun Turret |
  | World War | 1000 ore, 150 wood, 35s | Barracks | Rifleman, Scout Jeep, Battle Tank, Gun Turret, Flak Cannon, Oil Derrick, Airfield, War Balloon, Biplane |
  | Modern | 3000 ore, 600 wood, 400 oil, 65s | War Factory | Rocket Soldier, Heavy Tank, Attack Helicopter |

- **Defense:** the Watchtower (Medieval, needs Barracks) shoots ballista bolts that are strong against infantry and cavalry; the Gun Turret (World War) fires shells that beat vehicles; the Flak Cannon (World War) only shoots at aircraft, from long range.
- **Units:** click a unit in the sidebar to queue it at your Barracks or War Factory. You start with two Swordsmen, a Crossbowman and a Knight.
  - Barracks: Swordsman (plate armor, beats riflemen up close), Crossbowman (armor-piercing bolts), Knight (fast armored lancer), then Rifleman and Rocket Soldier.
  - War Factory: Catapult (lobs boulders from long range, crushes buildings) and Harvester, then Scout Jeep, Battle Tank and Heavy Tank.
  - Airfield (World War, needs a Refinery): War Balloon (slow, sees far, drops bombs), then Biplane (fast fighter, best against other aircraft) and Attack Helicopter (missiles that wreck tanks). Aircraft fly straight over buildings, woods and water.
  - Only weapons that can aim up hit aircraft: crossbows, ballista towers, rifles, machine guns, rockets, aircraft guns and flak. Swords, lances, catapults and tank cannons can't. Rocket Soldiers and the Flak Cannon are the best answers to helicopters.
  - Rockets beat armor, rifles beat unarmored infantry, swords beat rifles, crossbows pierce plate, tanks beat almost everything.
- **Orders:** left-click or drag to select. Right-click to move, send harvesters to ore or a refinery, or set a factory's rally point. Select a building to repair or sell it.
- **Stances:** there is no separate attack order. Units only move, and each unit's stance decides how it fights. Pick one from the command card for a unit or a whole selection:
  - **Stop & attack** (default): the unit stops to fight enemies it meets, then carries on to where it was going. Idle units engage anything in sight.
  - **Move & attack** (attack while moving): the unit shoots whatever is in range without stopping or turning aside. Idle, it holds its ground and fires.
  - **Don't attack:** the unit holds fire and runs away from armed enemies that come close or shoot at it.
- **Touch:** tap to select; with something selected, tap elsewhere to give an order. Drag to scroll.
- **Surrender** (online): the button in the top bar, clicked twice.
- **Camera (3D):** `W` `A` `S` `D`, the arrow keys or the screen edge to pan; `Q`/`E` or middle-drag to turn; scroll (mouse wheel or trackpad) to pan, `Shift`+wheel to pan sideways; `Ctrl`/`Cmd`+wheel or trackpad pinch to zoom; `Alt`+wheel or middle-drag up and down to tilt. On touch screens: drag to pan, pinch to zoom, twist with two fingers to turn.
- **Keys:** `M` move, `X` stop, `G` stop & attack, `F` move & attack (attack while moving), `V` don't attack, `R` repair, `Delete` (or `Backspace`) sell, `Ctrl`+`1-9` assign a group and `1-9` recall it, `H` select the Construction Yard and jump to it, `Space` jump to the last alert, `+`/`-` game speed, `P` pause.
- **Production hotkeys:** every structure, unit and research has a letter, shown on its sidebar button and lit while the building that makes it is selected. Select the Construction Yard (`H`) and press a structure's or research's letter; select a Barracks, War Factory or Airfield (a control group works well) and press a unit's letter. Press a finished structure's letter again to place it. Letters come from each item's name (`views/game/hotkeys.ts`), never use a camera key, and a definition can pick its own with `key`, so new units and buildings get one automatically.

See [docs/project/architecture.md](docs/project/architecture.md) for how the code is organised.
