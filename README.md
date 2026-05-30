# DArk

A top-down combat game built with plain HTML Canvas with no engines, no shortcuts, and no libraries.

---

## Files

- `index.html` : page structure and HUD
- `style.css` : HUD and overlay styling
- `game.js` : entire game engine

---

## Controls

| Key | Action |
|---|---|
| `WASD` | Move |
| Mouse | Aim |
| Left click | Shoot |
| `F` | Reload |
| `Q/E/R` | Use power-ups |
| `P/Esc` | Pause |

---

## Rendering Flow

Every frame runs three steps:

1. **Draw world**: rooms, enemies, walls, bullets, and the player are all painted onto the canvas at the camera offset.
2. **Build darkness mask**: an offscreen canvas is filled black, then a torch-cone wedge is cut out using `destination-out` compositing with a radial gradient so that light fades at the edges.
3. **Stamp mask**: the black mask is drawn on top of the world with `drawImage`, so anything outside the cone is hidden.

---

## Game Loop

`requestAnimationFrame` calls `main_game_loop()` every frame:

```
read input → move player → update AI → update bullets
→ update particles → detect room entry/exit → move camera
→ draw world → apply darkness mask → update minimap + HUD
```
---

## State Management

Everything lives in one object, `G` (`single_global_state_object`). All systems read and write it directly without cloning and events. The wall array (`G.walls`) is the one cached property, and is rebuilt only when a room clears or the player enters a new room.

---

## Collision Detection

Two primitives, both SAT-based, are used:

A **rect–circle** (`satRC`) finds the nearest point on a rectangle to a circle centre and checks if the distance is less than the radius. It is used for the player, enemies, and bullets vs walls. We want to slide across walls and not stop dead, so player and enemy movements' axes are stested separately. 

**Segment–segment** (`segHit`); standard parametric intersection, is used for line-of-sight checks (AI detection, torch visibility) and bullet reflection. When a bullet hits a wall, the surface normal is computed and velocity is reflected with `v' = v - 2(v·n)n`.

Every collision loop skips walls that are clearly out of range with a bounding-box check.

---

## Room Generation

The world is a 4 × 3 grid of 12 rooms, all in world space at once. The player walks through 60 px corridor gaps between rooms.

Each room wall has a centred 50 px doorway on every side that has a neighbour. When the player walks deep enough into a room (past 80% of the doorway width), red barriers snap shut across all doorways. once every enemy is killed, the barriers vanish. After this, the cleared roomstays open permanently.

Enemy count and stats scale with room index (0–11). Room 0 always has 2 basic patrol enemies, while later rooms get more enemies with higher health, speed, and fire rate. The enemy's type is chosen by a weighted random pick from six types: patrol, aggro, sniper, dasher, tank, and explosive.

---

## Enemy AI

Each enemy runs a simple state machine: `patrol → chase → attack`. An enemy only detects the player if the player's torch cone is pointing at them. So, teh tactic is that fighting in darkness keeps the player hidden.

| Type | Behaviour |
|---|---|
| Patrol | Wanders, shoots occasionally |
| Aggro | Fast, wide vision, strafes |
| Sniper | Long range, high damage, slow fire |
| Dasher | Rushes to close distance |
| Tank | Slow, tanky, fires a three-shot spread |
| Explosive | Rushes in and detonates on contact |

---

## Powerups

Power-ups are small dots with different effects, and are collected by moving over them. There are three inventory slots, which are activated with Q/E/R.

| | Effect |
|---|---|
| Shield | Absorbs one hit |
| Speed | Movement × 2 |
| Damage | Bullet damage × 2.5 |
| Invisible | Enemies can't detect you |
