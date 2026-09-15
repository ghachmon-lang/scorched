# Scorched Earth (mobile)

A remake of the 1991 DOS artillery classic **Scorched Earth** ("The Mother of All Games") for phones. Every player plays on their own phone, at their own pace: the game lives on a tiny server, you get a notification when it is your turn, and you can close the app and come back hours later.

![Scorched Earth screenshot](docs/screenshot.png)

Same visuals, same gameplay: 640×360 pixel battlefield with gradient skies and strata-shaded hills, tiny tanks, ringed explosions, falling dirt, wind, walls, talking tanks, a shop between rounds and the whole 1.5-era arsenal. Only better: touch controls, drag-to-aim, online rooms, turn notifications, and no DOSBox required.

## How playing works

1. One player taps **New game with friends** and gets a four-letter room code plus a share link.
2. Friends tap **Join with a room code** (or open the link) on their own phones. The host can add computer tanks and sets the number of rounds, then starts.
3. Take your turn whenever you like. Others get a **"your turn" notification** (if they allowed it) and the game is waiting for them under **My games** on the menu, exactly where it was.
4. Someone stopped playing? The host can hand their tank to the computer from the in-game menu; they can take it back later.

Only one player needs the app open for the computer tanks to move. Nothing depends on anyone staying connected.

There is also **Practice against the computer**: a local game on one phone, not saved.

## Deploying your own copy

Two parts: the game (static files, GitHub Pages) and the room server (a Cloudflare Worker with one Durable Object per room; the free plan is plenty).

### 1. The room server

```
cd server
npm install
npx wrangler login        # opens the browser once
npx wrangler deploy       # prints the Worker URL, e.g. https://scorched-earth.<you>.workers.dev
```

Optional but recommended, turn notifications:

```
npm run keys                                   # prints a VAPID key pair
# paste the public key into wrangler.toml as VAPID_PUBLIC_KEY, set VAPID_SUBJECT to a mailto: you own
npx wrangler secret put VAPID_PRIVATE_JWK      # paste the private JSON when prompted
npx wrangler deploy
```

You can also let GitHub deploy the server for you: add repository secrets `CLOUDFLARE_API_TOKEN` (a token with *Workers Scripts: Edit*) and `CLOUDFLARE_ACCOUNT_ID`; the `Deploy room server` workflow runs whenever `server/` changes on `main`.

### 2. The game

* Paste the Worker URL into `src/config.js` (`SERVER_URL`) and push to `main`.
* Enable GitHub Pages once: Settings → Pages → Source: **GitHub Actions**. The `Test and deploy` workflow publishes the game at `https://<owner>.github.io/scorched/` on every push.
* Open that link on your phone and use "Add to Home Screen". On iPhone, notifications only work for the home-screen version.

Any static host works instead of Pages: the game is plain files with no build step. A phone can also point at a different server under Settings → Advanced, which is handy for testing.

### Running everything locally

```
npm start                      # game on http://localhost:8080 (prints your Wi-Fi address too)
cd server && npm run dev       # room server on http://127.0.0.1:8787
```

Then put `http://127.0.0.1:8787` (or your machine's address for phones on the same Wi-Fi) into Settings → Advanced → Server URL.

## Controls

| Touch | Keyboard |
|---|---|
| Drag anywhere on the battlefield: left/right changes the angle, up/down the power | `←` `→` angle, `↑` `↓` power (`Shift` for bigger steps), `PgUp`/`PgDn` power ±100 |
| ◀ ▶ − + buttons, hold to repeat | `Tab` / `Shift+Tab` cycle weapons |
| WEAPON and ITEMS sheets | `W` weapons, `I` items |
| FIRE | `Space` or `Enter` |
| ⏩ fast-forward computer turns, ☰ menu | `F` fast-forward, `Esc` menu |

Angle 0 points right, 90 straight up, 180 left. Wind pushes shells in the direction of the arrow. A ▼ marker along the top edge tracks shells that fly off the top of the screen.

## What's in the box

* **Weapons:** Baby Missile, Missile, Baby Nuke, Nuke, Leap Frog, Funky Bomb, MIRV, Death's Head, Napalm, Hot Napalm, Tracer, Smoke Tracer, Baby/normal/Heavy Roller, Riot Charge, Riot Blast, Riot Bomb, Heavy Riot Bomb, Baby/normal/Heavy Digger, Baby/normal/Heavy Sandhog, Dirt Clod, Dirt Ball, Ton of Dirt, Liquid Dirt, Laser.
* **Accessories:** Shield, Deflector Shield, Force Shield, Heavy Shield, Mag Deflector, Parachutes, Batteries, Fuel Tanks, Auto Defense.
* **Physics options:** gravity, constant or changing wind, concrete / rubber / spring / wrap-around / no walls (or random per shot), falling dirt on or off, chain-reacting tank explosions.
* **Terrain:** flat, hills, mountains, canyon, or random, with six sky/land colour schemes.
* **Computer players:** Moron, Shooter, Poolshark, Tosser, Chooser, Spoiler and Cyborg, each with its own aim, weapon preferences and shopping habits.
* **Economy:** cash for damage and kills, a round-win bonus, interest, and a shop between rounds.
* **Talking tanks**, sound effects (PC-speaker flavoured), haptics on hits, in-room chat, and a PWA manifest plus service worker for offline loading, home-screen install and notifications.

## How it works

The simulation (`src/game.js`) is deterministic: all randomness comes from a seeded generator and transcendental maths are quantised, so Android, iOS and desktop browsers compute bit-identical games. The server never runs the game. A room is a seed, a roster and an append-only log of sequenced commands (fire, use item, move, shop, hand over). Each phone replays the log through the same simulation and lands on the same state, whether it has been open all along or is reopened a week later. Every shot carries a checksum of the sender's state; a mismatch makes the phone reload from the log.

The server is a Cloudflare Worker (`server/src/index.js`) that routes each room code to a Durable Object (`server/src/room.js`) holding the lobby, the log and WebSocket fan-out for live updates. Phones report where the game stands after each command so the server can send "your turn" pushes (empty Web Push messages signed with VAPID; the service worker asks the server what changed and shows the notification).

## Development

```
npm test          # simulation tests (determinism, every weapon, items, shop, snapshots, AI) and server tests
npm start         # static server on port 8080
```

| File | What it does |
|---|---|
| `src/game.js` | The simulation: rounds, turns, firing, every weapon behaviour, damage, falling, economy, snapshots. DOM-free. |
| `src/physics.js` | Projectile integration shared by the game and the AI aiming search. |
| `src/terrain.js` | Pixel terrain: generation, craters, tunnels, dirt clods, animated falling dirt. |
| `src/ai.js` | Computer opponents. |
| `src/weapons.js` | Weapon and accessory catalogue and economy constants. |
| `src/render.js`, `src/palette.js`, `src/font.js` | Canvas renderer, colour schemes, bitmap font. |
| `src/main.js`, `src/ui.js`, `src/input.js` | App controller (rooms, replay, notifications), screens, touch/keyboard input. |
| `src/net.js` | Client for the room server. |
| `src/config.js` | The server URL baked into the deployed game. |
| `sw.js` | Service worker: offline cache and push notifications. |
| `server/` | The Cloudflare Worker and Durable Object, with its own tests and deploy scripts. |

## Credits

Scorched Earth was written by Wendell Hicken in 1991. This is an independent fan remake written from scratch; it contains no code or assets from the original.
