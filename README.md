# Age of Villages — Browser RTS

A fully playable **Age of Empires-style real-time strategy game** running entirely in the browser, built with **Three.js** (WebGL PBR rendering) and **Next.js 16**.

![Age of Villages](https://img.shields.io/badge/genre-RTS-red) ![Three.js](https://img.shields.io/badge/Three.js-r185-black) ![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## Features

- **Full 3D PBR world** — heightmap terrain with multi-biome splat shader (grass/dirt/rock/sand), procedural PBR textures (color + normal + roughness), ACESFilmic tone mapping, soft shadows, image-based lighting via `RoomEnvironment`.
- **Complete core loop** — gather wood/food/gold → construct buildings → train villagers and soldiers → advance through 4 ages → destroy the enemy.
- **4 Ages** — Dark → Feudal → Castle → Imperial, each unlocking stronger units and buildings.
- **11 unit types** — villager, 4 infantry tiers (Militia → Two-Handed Swordsman), 3 archer tiers, 3 cavalry tiers, and a battering ram.
- **9 building types** — Town Center, House, Barracks, Archery Range, Stable, Siege Workshop, Storage Pit, Watch Tower, Wall.
- **Classic RTS controls** — click to select, drag to box-select, right-click to move / gather / attack. Ghost preview for building placement.
- **A\* pathfinding** on a 180×180 tile grid with path simplification and unit separation.
- **Enemy AI** — booms its economy, advances ages, builds military, and sends wave attacks every ~75 seconds.
- **HUD** — resource bar, build/train panel, selection panel with production queues, minimap with click-to-pan, help overlay, win/lose screen.

## Play

The game runs at the root route `/`. On load you'll spawn with a Town Center, 3 villagers, and a scout. Click the **?** button (top-right) for the full controls guide.

### Controls

| Action | Input |
|---|---|
| Pan camera | `WASD` / arrows / edge-pan |
| Zoom | scroll wheel |
| Rotate camera | `Q` / `E` / middle-drag |
| Select unit | left-click |
| Box-select | drag left-click |
| Move / gather / attack | right-click |
| Build | deselect, click building button, left-click valid ground |
| Cancel placement | `Esc` |
| Help | `?` button |

## Develop

```bash
bun install
bun run dev
```

Open http://localhost:3000.

### Build

```bash
bun run build
bun run start
```

## Deploy on Vercel

This repo includes a `vercel.json`. Push to GitHub and import the repo at [vercel.com/new](https://vercel.com/new) — Vercel auto-detects Next.js and uses `bun install` + `next build`.

## Project structure

```
src/
  app/
    page.tsx          # React HUD overlay + minimap canvas
    layout.tsx
  game/
    constants.ts      # game balance (units, buildings, ages, costs, HP, damage)
    types.ts          # state interfaces
    textures.ts       # procedural PBR texture factory (canvas + noise + Sobel)
    terrain.ts        # heightmap terrain + 4-way splat shader
    models.ts         # procedural unit/building/resource meshes
    camera.ts         # RTS camera rig (orbit/pan/zoom/rotate)
    pathfinding.ts    # A* on tile grid
    engine.ts         # main GameEngine (rendering, state, input, economy, combat, AI)
  components/ui/      # shadcn/ui components
```

## Tech stack

- **Next.js 16** (App Router) + **TypeScript 5**
- **Three.js r185** (PBR rendering, custom shaders via `onBeforeCompile`)
- **Tailwind CSS 4** + **shadcn/ui** for HUD components
- **Bun** as package manager and runtime

## License

MIT
