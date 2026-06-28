# Three.js r160+ PBR RTS — Technical Reference

Research-only reference for building a semi-realistic RTS (0 A.D. / Battle for Middle-earth vibe) in Three.js r160+. All findings cite real sources (URLs inline). No game code — just patterns, snippets, and decisions.

---

## Rendering Setup

Renderer + color-management baseline for r160+ (color management became default-on in r152+ and solidified through r164; see [three.js issue #29549](https://github.com/mrdoob/three.js/issues/29549) and the [r164 SRGBColorSpace thread](https://discourse.threejs.org/t/issue-with-srgbcolorspace-output-after-upgrade-r164/66217)):

```js
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;        // default since r152, set explicitly anyway
renderer.toneMapping = THREE.ACESFilmicToneMapping;      // cinematic, matches 0 A.D./BFME look
renderer.toneMappingExposure = 1.0;                       // tune 0.9–1.2; bump to fight ACES "wash-out"
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

- **MeshStandardMaterial** is the workhorse for terrain, units, buildings — full PBR (metalness/roughness) at lowest cost. ([three.js MeshPhysicalMaterial docs](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) note MeshPhysicalMaterial is "higher performance cost, per pixel, than other three.js materials".)
- **MeshPhysicalMaterial** only where you need clearcoat (wet rocks, polished armor), sheen (cloth/vegetation), or transmission (water/glass). The [three.js forum cost discussion](https://discourse.threejs.org/t/meshphysicalmaterial-can-i-measure-how-much-more-expensive-it-is/60398) confirms clearcoat/sheen are cheap; **transmission is expensive** (forces a render pass) — avoid it for many units.
- **Environment map via `RoomEnvironment` + `PMREMGenerator`** gives neutral IBL reflections without shipping an HDR file — the [official RoomEnvironment docs](https://threejs.org/docs/pages/RoomEnvironment.html) show the canonical 3-liner:

```js
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
```

  For a more "outdoor sky" vibe, load an HDRI via `RGBELoader` → `pmrem.fromEquirectangular(hdr).texture`. See [three.js Journey: environment map](https://threejs-journey.com/lessons/environment-map) and the [SO PMREM preprocessing answer](https://stackoverflow.com/questions/66949741/preprocessing-an-environment-map-with-pmremgenerator).
- **Texture color spaces**: mark every *color/albedo* texture `texture.colorSpace = THREE.SRGBColorSpace`; leave data textures (normal, roughness, AO, metallic) in `LinearSRGBColorSpace`. The [r164 discourse thread](https://discourse.threejs.org/t/issue-with-srgbcolorspace-output-after-upgrade-r164/66217) explicitly recommends assigning colorSpace per texture. Don McCurdy's [Color management in three.js](https://www.donmccurdy.com/2020/06/17/color-management-in-threejs/) remains the canonical TL;DR.
- **ACES trade-off**: it lowers contrast/saturation on textured surfaces ([discourse: ACESFilmic leading to low-contrast textures](https://discourse.threejs.org/t/acesfilmictonemapping-leading-to-low-contrast-textures/15484)). Compensate by authoring albedos slightly punchier, or raise `toneMappingExposure` to ~1.1–1.2. UI/selection ring colors that must stay pure can use a `MeshBasicMaterial` (bypasses tonemapping) — see [SO: material burnt by ACES](https://stackoverflow.com/questions/63267940/material-using-plain-colours-getting-burnt-when-using-three-acesfilmictonemappin).

---

## Lighting & Shadows

- **Sun**: a single `DirectionalLight` cast as the key light. Per [sbcode.net Directional Light Shadow](https://sbcode.net/threejs/directional-light-shadow) and [dev.to Mastering Shadows in Three.js](https://dev.to/peter3riding/mastering-shadows-in-threejs-setup-configuration-and-optimization-39nn), the shadow uses an **OrthographicCamera** — you *must* manually set its `left/right/top/bottom/near/far` to tightly fit the visible play area or shadows blur/stretch.
- **Ambient/hemisphere fill**: `HemisphereLight(skyColor, groundColor, intensity)` is cheap and gives the outdoor BFME look; combine with the env map above rather than piling on point lights.
- **Shadow type matrix** (from the [Three.js Shadows Explained tutorial](https://www.youtube.com/watch?v=AUF15I3sy6s)):
  - `BasicShadowMap` — never.
  - `PCFShadowMap` — hard edges, cheapest.
  - `PCFSoftShadowMap` — **recommended default** for RTS at medium scale; good cost/quality.
  - `VSMShadowMap` — softer, blurrier, uses 2× memory (float targets). Better for large soft shadows but prone to light-bleeding on thin geometry.
- **Shadow camera recipe**:

```js
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);              // 4096 for hero shots; 1024 for low-end
const c = sun.shadow.camera;                     // OrthographicCamera
c.left = -120; c.right = 120; c.top = 120; c.bottom = -120;
c.near = 0.5; c.far = 500;
sun.shadow.bias = -0.0005;                       // kill peter-panning / acne
sun.shadow.normalBias = 0.02;                    // kill self-shadow artifacts on sloped terrain
```

- **CSM for large maps**: the [`StrandedKitty/three-csm`](https://github.com/StrandedKitty/three-csm) package implements cascaded shadow maps — higher-res shadows near camera, lower far away. Required once your play area exceeds ~200×200 units and a single 2048 shadow map starts pixelating. [SBCODE CSM tutorial](https://sbcode.net/threejs/csm) walks setup; the [WebGPU CSM discourse thread](https://discourse.threejs.org/t/cascaded-shadow-maps-csm-on-webgpu/84235) notes ~20% of shadowed pixels come from the high-res cascade — a big perf win for outdoor scenes. (Note: `three-csm` patches materials; verify compatibility with your three.js minor version.)
- Keep `shadow.autoUpdate = true` only when units move; for static buildings set `shadow.needsUpdate = false` after first render to save GPU.

---

## Terrain

- **Heightmap → geometry**: build a high-segment `PlaneGeometry`, then displace vertices in JS or in the vertex shader by sampling a grayscale heightmap texture (`texture2D(heightMap, uv).r * amplitude`). The [Stack Overflow: Texture splatting with Three.js](https://stackoverflow.com/questions/18880715/texture-splatting-with-three-js) answer and [Nathan Pointer's "Rendering semi-realistic Landscapes in the browser"](https://nathanpointer.com/blog/landscapes) both describe passing a `vAmount` varying for slope/height-based coloring. [GeekyAnts' real-world terrain article](https://techblog.geekyants.com/recreating-real-world-terrain-with-react-threejs-and-webgl-shaders) is the same pattern in React.
- **Multi-texture splatting** via blend map (RGB = 3 channels, A = 4th). From [three.js forum: multiple textured terrain](https://discourse.threejs.org/t/how-to-create-a-multiple-textured-terrain/5069) (page 2 confirms RGB blend map is the standard). Pseudo-shader:

```glsl
// fragment shader — mix grass/dirt/rock/sand by height + slope + splat map
uniform sampler2D grass, dirt, rock, sand, splat;
varying float vHeight; varying float vSlope; varying vec2 vUv;
void main() {
  vec4 s = texture2D(splat, vUv);
  // large UV tiling per layer to avoid repetition
  vec2 tUv = vUv * 24.0;
  vec3 c = texture2D(grass, tUv).rgb * s.g;
  c += texture2D(dirt,  tUv).rgb * s.r;
  c += texture2D(rock,  tUv).rgb * s.b;          // steep slopes → rock
  c += texture2D(sand,  tUv).rgb * s.a;          // low altitude → sand
  // slope-based override (steep = rock regardless of splat)
  c = mix(c, texture2D(rock, tUv).rgb, smoothstep(0.55, 0.75, vSlope));
  gl_FragColor = vec4(c, 1.0);
}
```

  Implement by extending `ShaderMaterial` (or `onBeforeCompile` patching `MeshStandardMaterial` to keep PBR lighting — preferred so terrain receives shadows & env reflections).

- **Avoiding texture repetition** (the classic RTS eyesore):
  1. **Triplanar mapping** for cliffs/steep slopes — blends 3 projections so vertical faces aren't stretched. [three.js forum: Tri-plannar mapping](https://discourse.threejs.org/t/tri-plannar-mapping-in-three-js/40335).
  2. **Infinite splatting / stochastic tiling** — SimonDev's [Triplanar/Infinite Splatting/Blending/Bombing](https://www.youtube.com/watch?v=rNuDkDhadfU) video covers several techniques (random offset per tile, hash-based blend).
  3. **Two scales of the same texture** mixed by a low-frequency noise — cheap and effective.
- **LOD**: chunk the terrain into NxN tiles, use `THREE.LOD` or manual distance culling to drop distant tiles to lower segment counts.

---

## Units & Buildings

- **InstancedMesh** for unit hordes. [Three.js InstancedMesh docs](https://threejs.org/docs/pages/InstancedMesh.html). One `InstancedMesh` per unit type (swordsman, archer, …); update per-instance matrix each frame. The [Three.js InstancedMesh performance optimizations devlog](https://www.youtube.com/watch?v=fMgIW2Kyad4) shows real-world gains replacing N meshes with 1 InstancedMesh.
- **Per-instance selection highlights**: `OutlinePass` from `three/examples/jsm/postprocessing/OutlinePass.js` **does not support InstancedMesh** per [three.js issue #18533](https://github.com/mrdoob/three.js/issues/18533) and the [forum OutlineEffect-on-instances thread](https://discourse.threejs.org/t/outlineeffect-on-instances-of-instancedmesh/66175). Practical alternatives:
  - **Selection ring decal**: a flat ring mesh (or `DecalGeometry`) projected onto terrain under each selected unit — the standard 0 A.D./StarCraft look. Cheapest, most readable.
  - **Per-instance tint via `instanceColor`**: patch the material (`mesh.material.onBeforeCompile`) to read `instanceColor` and lerp toward a team color; toggle a per-instance "selected" attribute. Forum: [Highlighting an instance in InstancedMesh](https://discourse.threejs.org/t/highlighting-an-instance-in-instancedmesh/14776) and [change texture/color per instance](https://discourse.threejs.org/t/how-to-change-texture-color-per-object-instance-in-instancedmesh/11271).
  - **Custom silhouette pass**: render selected instances to a stencil/depth-only buffer with back-face culling flipped, in team color. (More work but matches BFME's painted-silhouette look.)
- **Silhouette readability tips** (the RTS art-direction bit):
  - Keep unit meshes low-poly with strong, exaggerated silhouettes — a spearman reads from 30m up because of the spear shape, not because of textures.
  - Author albedo colors slightly desaturated; let team-color accents (cloak, banner) carry identity. ACES tonemapping will further desaturate, so plan for it.
  - Use rim/fresnel lighting (`material.onBeforeCompile` to add `pow(1.0 - dot(N, V), 2.0)` term) — gives units a subtle halo against the terrain so they pop at the camera angle RTS uses.
  - Animation: keep walk cycles snappy (high frequency) so motion is visible at distance.
- **Buildings**: regular `Mesh` + `LOD` is fine (fewer, bigger, more detailed). Bake AO into vertex colors or a lightmap texture; let the runtime env map handle reflections.

---

## Camera

RTS rig: orbit around a focal point on the ground, with edge-pan, WASD pan, scroll-zoom (clamped), Q/E rotate. Two viable paths:

1. **Use [`yomotsu/camera-controls`](https://github.com/yomotsu/camera-controls)** — drop-in replacement for `OrbitControls` with `rotate()`, `zoom()`, `truck()`, `moveTo()` tweening APIs. Less code, well maintained.
2. **Hand-rolled** (full control over RTS feel) — sketch:

```js
// focal point on terrain; camera orbits at distance + pitch
let focal = new THREE.Vector3(0, 0, 0);
let yaw = 0, pitch = 0.9, distance = 40;
const minDist = 12, maxDist = 90, minPitch = 0.3, maxPitch = 1.4;

function updateCamera() {
  camera.position.set(
    focal.x + distance * Math.sin(yaw) * Math.cos(pitch),
    focal.y + distance * Math.sin(pitch),
    focal.z + distance * Math.cos(yaw) * Math.cos(pitch)
  );
  camera.lookAt(focal);
}

// WASD / arrow pan in screen space
const panSpeed = 0.6;
function pan(dx, dz) {
  const forward = new THREE.Vector3().subVectors(focal, camera.position); forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  focal.addScaledVector(right, dx * panSpeed).addScaledVector(forward, dz * panSpeed);
  updateCamera();
}

// scroll wheel = dolly (zoom) — clamp
onWheel: distance = clamp(distance + deltaY * 0.05, minDist, maxDist); updateCamera();

// Q/E = yaw around focal
onKeyQ/E: yaw += dir * 0.03; updateCamera();

// edge-pan: when mouse within N px of viewport edge, pan in that direction
onMouseMove: if (e.clientX < edge) pan(-1, 0); else if (e.clientX > W-edge) pan(1, 0); …
```

- Set `camera.rotation.order = 'YXZ'` (yaw-pitch-roll) to avoid gimbal flip — [discourse: camera rotation axis glitch](https://discourse.threejs.org/t/camera-rotation-axis-glitch/49477).
- Zoom by changing **position/distance**, not FOV (`yomotsu/camera-controls` makes this distinction explicit). FOV-zoom distorts perspective and looks wrong for RTS.
- For Battle-for-Middle-earth vibe: cap pitch so you never go near top-down — ~35–55° from horizontal.

---

## Pathfinding

**Chosen: hybrid — A\* for single-unit/formation leader paths + Flow Field for groups sharing a destination.**

- **A\***: classic grid pathfinder, optimal single-path cost. Use a binary heap (`MinHeap`) for the open set; implement tie-breaking (`cross product` heuristic) so paths don't zig-zag on open terrain. Good for: hero units, formation leaders, building placement checks.
- **Flow Field (Dijkstra-based vector field)**: build a cost grid, run Dijkstra from the destination to fill every cell with the direction-to-goal, then each unit samples its cell and steers. Much cheaper than N×A\* when 200 units all path to the same barracks. References: [jdxdev: RTS Pathfinding – Flowfields](https://www.jdxdev.com/blog/2020/05/03/flowfields), [GameDev.SE: How does Flow Field pathfinding work?](https://gamedev.stackexchange.com/questions/387/how-does-flow-field-pathfinding-work), [SO: FlowField Pathfinding on Large RTS Maps](https://stackoverflow.com/questions/72014167/flowfield-pathfinding-on-large-rts-maps). Age of Darkness shipped 60K units this way — [GDC talk: Lighting the Path](https://www.youtube.com/watch?v=OHd0Cy7hXAw).
- **Hierarchical / chunked** for very large maps: [SO answer](https://stackoverflow.com/questions/72014167/flowfield-pathfinding-on-large-rts-maps) suggests HPA\* (Hierarchical Pathfinding A\*) layered on the flow field — compute flow fields per region, stitch at portals. Avoids the cost of a full-map Dijkstra.
- **Obstacles**: static (buildings, terrain cliffs) → baked into the cost grid as impassable/walls. Dynamic (other units) → local steering (boids-style separation + arrival) on top of the flow field, not in the pathfinder.
- **Implementation tip**: run pathfinding in a Web Worker (rAF-budgeted, e.g. max 4ms/frame) so the render loop never blocks. Pool your grid arrays.

---

## Post-processing

- **Prefer [`pmndrs/postprocessing`](https://github.com/pmndrs/postprocessing)** over the built-in `EffectComposer`. It merges effects into fewer passes via `EffectPass` — major perf win, and it integrates cleanly with R3F. The built-in `EffectComposer` is still fine for prototyping.
- **Recommended for RTS**:
  - **Bloom** — but **selective**: raise threshold > 1.0 and author emissive intensity > 1 only on things that should glow (magic, torches, UI). [pmndrs selective bloom discourse](https://discourse.threejs.org/t/pmndrs-post-processing-how-to-get-selective-bloom/58452). Affects material authoring, not just the pass.
  - **SMAA** (sub-pixel AA) — cheaper than MSAA at high res, looks better than FXAA. Or keep `antialias:true` on the renderer and skip post-AA.
  - **Vignette + slight color grading** (`HueSaturation`, `BrightnessContrast`) — cheap, huge mood boost, nails the BFME painted feel.
- **Skip or use sparingly**:
  - **SSAO** — pretty but expensive; for top-down RTS where units are small on screen, the payoff is low. If you must, use `GTAO` from pmndrs at half-res.
  - **SSR / screen-space reflections** — skip; env map handles building reflections well enough.
  - **DOF** — skip for gameplay; only for cinematic pause/menu.
- **Perf knobs**: render post at half resolution for AO/bloom, then upscale. Watch the [SO: Three.js Bloom effect performance](https://stackoverflow.com/questions/57055980/three-js-bloom-effect-performance) caution — every unique material is a draw call; bloom can't fix bad batching.
- **r183+ note**: three.js is introducing `RenderPipeline` as a modern EffectComposer replacement ([threejsroadmap 2026 guide](https://threejsroadmap.com/blog/the-complete-guide-to-threejs-post-processing-in-2026)) — worth tracking but not production-ready for r160-era code today.

---

## Texture Asset Sources

All CC0 / public-domain — safe for commercial use without attribution:

| Source | URL | License | Notes |
|---|---|---|---|
| **ambientCG** (formerly cc0textures.com) | https://ambientcg.com | [CC0 1.0](https://ambientcg.com) — "free to use without attribution - even in commercial circumstances" | Largest free PBR library (~2000+ materials), 2K/4K/8K, includes HDRIs & models. The original `cc0textures` URL now redirects here. |
| **Poly Haven** (formerly Texture Haven / HDRI Haven / 3D Model Haven) | https://polyhaven.com | [CC0 1.0](https://polyhaven.com/license) — "use for absolutely any purpose without restrictions" ([FAQ](https://docs.polyhaven.com/en/faq) confirms commercial use) | Curated, very high quality. Textures + HDRIs + models in one place. |
| **ShareTextures** | https://www.sharetextures.com | CC0 — "copyright-free... commercial projects too" | Good coverage of ground/fabric/architectural textures. |
| **TextureCan** | https://www.texturecan.com | [Royalty-free, no attribution](https://www.texturecan.com/terms) — "any purposes, including commercial use" | Smaller library, handy for tileable ground textures. |

Packing tip: download at 2K for terrain tiling textures (good balance of GPU memory vs. close-up quality); use 1K for unit detail maps. Convert to WebP/KTX2 (Basis) with `KTX2Loader` for ~70% size reduction — material authoring is unchanged.

---

## CDN / Next.js Integration

### ESM CDN via import map (zero-build prototype)

```html
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  }
}
</script>
<script type="module">
  import * as THREE from 'three';
  import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
  // …
</script>
```

- **unpkg** (`https://unpkg.com/three@VERSION/build/three.module.js`) and **jsDelivr esm.run** (`https://esm.run/three@VERSION`) and **esm.sh** (`https://esm.sh/three@VERSION`) all work. See [unpkg.com](https://unpkg.com), [esm.sh](https://esm.sh), [jsDelivr esm.run announcement](https://github.com/jsdelivr/jsdelivr/issues/18263).
- The `three/addons/` bare specifier pattern is required because three.js addons import from `"three"` — the import map resolves it. Discourse: [Why does three.js require an import map?](https://discourse.threejs.org/t/why-does-three-js-require-a-import-map/40308). Use [`es-module-shims`](https://www.jsdelivr.com/package/npm/es-module-shims) if you need older-browser fallback for import maps.

### Next.js integration

Two paths, both viable for App Router (Next 13+/14+/15+):

1. **Plain three.js in a client component** (most control):
   ```js
   // app/page.tsx (server component) → wraps client canvas
   import dynamic from 'next/dynamic';
   const Game = dynamic(() => import('./Game'), { ssr: false });
   export default function Page() { return <Game />; }
   ```
   `Game.tsx` starts with `'use client'` and mounts three.js to a `<canvas>` ref in `useEffect`. The `ssr:false` is **mandatory** — three.js touches `window`/`document` and will crash SSR. [Next.js discussion #13839](https://github.com/vercel/next.js/discussions/13839) is the canonical "dynamic import blank screen" thread; [threejsresources.com Next.js guide](https://threejsresources.com/frameworks/three-js-nextjs) confirms the pattern.
2. **React Three Fiber** (`@react-three/fiber` + `@react-three/drei`): declarative, integrates with React state for UI. Mark `<Canvas>` in a `'use client'` file. [docs.pmnd.rs](https://docs.pmnd.rs/react-three-fiber/?ref=trap.jp), [Ryosuke's R3F+Next.js starter](https://whoisryosuke.com/blog/2022/react-three-fiber-and-nextjs-starter-template). Watch out for [Next 15 build issues with GLB assets](https://stackoverflow.com/questions/79498790/three-js-r3f-with-next-js-build-deploy-issue) — keep model loading client-side.

**npm package list** (recommended set):

```
three@^0.160.0
@types/three              # devDep
@react-three/fiber        # if using R3F
@react-three/drei         # helpers: OrbitControls, Environment, useGLTF, Stats
postprocessing            # pmndrs post-fx
three-csm                  # cascade shadows (if large map)
yomotsu/camera-controls   # or hand-roll
```

---

## Open-source References

Repos to study (ranked by relevance to a Three.js RTS):

| Repo | URL | Why study it |
|---|---|---|
| **andvolodko/three.js-rts-ecs-engine** | https://github.com/andvolodko/three.js-rts-ecs-engine | TypeScript RTS engine demo using ECS — closest analog to what you're building. Good for unit/system architecture. |
| **VOIDSTRIKE** (Reddit WIP log) | https://www.reddit.com/r/threejs/comments/1rus2v8/building_an_rts_with_threejs_webgpu_perinstance | Browser-native RTS, Three.js + WebGPU, per-instance TAA. Pushes three.js hard — reference for advanced rendering tricks. |
| **jdekarske/webaoe** | https://github.com/jdekarske/webaoe | TypeScript library rendering AoE2-style 3D maps in three.js. Proof-of-concept; useful for terrain/tilemap ideas. |
| **coloradude/resource-strategy-game** | https://github.com/coloradude/resource-strategy-game | three.js + Node + Express AoE/Civ/StarCraft-like. Resource economy + server architecture reference. |
| **MavonEngine/Core** | https://github.com/MavonEngine/Core | Open-source Three.js game engine for single/multiplayer; rendering + physics + networking + animation. Heavier than needed but good architecture reference. |
| **obecerra3/OpenWorldJS** | https://github.com/obecerra3/OpenWorldJS | 3D open-world engine with three.js + ammo.js (physics). Large-scene chunking reference. |
| **Langenium** | https://discourse.threejs.org/t/langenium-an-open-source-three-js-game/83150 | Open-source three.js game, 2-year dev log — battle-tested patterns and pitfalls. |
| **emnh/rts-blog** | https://emnh.github.io/rts-blog | RTS in WebGL + ClojureScript with detailed blog — pathfinding & flow field write-ups worth reading even though it's not JS. |
| **threejs-games.github.io** | https://threejs-games.github.io | Reusable three.js game component library — combine-and-create scenes; good source of drop-in components. |

> Note: the user-mentioned "ages-of-conflict" is the commercial **Ages of Conflict: World War Simulator** by JoySpark Games ([Google Play](https://play.google.com/store/apps/details?id=com.JoySparkGames.AgesofConflict)) — a map-simulation game, not a three.js open-source repo. Use it as visual reference for top-down army-on-map aesthetics, not as code to study.

---

## Quick Decision Summary

| Concern | Decision |
|---|---|
| Material | `MeshStandardMaterial` for 95% of meshes; `MeshPhysicalMaterial` only for clearcoat/water |
| Tone mapping | `ACESFilmic`, exposure 1.0–1.2 |
| Env map | `RoomEnvironment` + PMREM (no HDRI shipping) or one outdoor HDRI |
| Shadows | `PCFSoftShadowMap` + tight ortho shadow cam; `three-csm` if map > ~200 units |
| Terrain | Heightmap-displaced `PlaneGeometry` + custom splat shader (extend MeshStandardMaterial via `onBeforeCompile`) |
| Units | `InstancedMesh` per type; selection via ring decal + per-instance team-color tint |
| Camera | Hand-rolled orbit-around-focal with edge-pan + WASD + clamp-zoom + Q/E rotate |
| Pathfinding | A\* for leaders/heroes + Flow Field for groups; Web Worker; HPA\* if map huge |
| Post-fx | `pmndrs/postprocessing`; selective bloom + SMAA + vignette/grade; skip SSAO/SSR/DOF |
| Textures | ambientCG + Poly Haven (both CC0); serve as KTX2 |
| Delivery | Next.js App Router + `dynamic(..., {ssr:false})` client canvas; or R3F |
