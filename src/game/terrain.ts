// ============================================================================
// Terrain generator: 180x180 heightmap + biome splat map + PBR splat shader.
// Uses Multi-layer parallax-free splatting by blending 4 textures
// (grass/dirt/rock/sand) based on height + slope + a painterly splat map.
// ============================================================================

import * as THREE from 'three';
import { TILE, MAP_TILES, MAP_SIZE, TILE_RES } from './constants';
import { getTextures } from './textures';

// --- Value noise (deterministic) for terrain heightmap ---------------------
function hash2(x: number, y: number, seed: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 71.13) * 43758.5453;
  return n - Math.floor(n);
}
function smoothstep(t: number) { return t * t * (3 - 2 * t); }
function valueNoise2D(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const ux = smoothstep(fx), uy = smoothstep(fy);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy)
       + c * (1 - ux) * uy + d * ux * uy;
}
function fbm2(x: number, y: number, seed: number, octaves: number) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 17);
    freq *= 2; amp *= 0.5;
  }
  return sum;
}

export interface TerrainData {
  mesh: THREE.Mesh;
  heights: Float32Array;        // (MAP_TILES+1)^2 heights
  splat: Uint8Array;            // (MAP_TILES+1)^2 * 4 (RGBA splat weights)
  getHeightAt: (x: number, z: number) => number;
  isWaterAt: (x: number, z: number) => boolean;
  waterMesh?: THREE.Mesh;
  terrainGroup: THREE.Group;
}

// Build the terrain. World XZ spans [-MAP_SIZE/2, +MAP_SIZE/2].
export function buildTerrain(scene: THREE.Scene, seed = 1337): TerrainData {
  const segs = MAP_TILES; // segments per side (verts = segs+1)
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2); // lay flat on XZ

  // Heights: 1 vertex per (segs+1)^2
  const vertCount = (segs + 1) * (segs + 1);
  const heights = new Float32Array(vertCount);
  const splat = new Uint8Array(vertCount * 4);

  const heightScale = 14; // max amplitude
  const waterLevel = 0.5; // below this = water
  const baseSeed = seed;

  // Generate heights via fbm + a couple of broad hills for variety
  for (let zi = 0; zi <= segs; zi++) {
    for (let xi = 0; xi <= segs; xi++) {
      const i = zi * (segs + 1) + xi;
      const u = xi / segs;       // 0..1
      const v = zi / segs;
      // World coordinates for noise sampling
      const nx = u * 6;
      const ny = v * 6;
      // Base rolling hills
      let h = fbm2(nx, ny, baseSeed, 5) * heightScale;
      // Add a couple of large mountain bumps for visual interest, away from corners
      const dx1 = u - 0.78, dy1 = v - 0.20;
      const dx2 = u - 0.22, dy2 = v - 0.78;
      const m1 = Math.max(0, 1 - Math.hypot(dx1, dy1) * 3) * heightScale * 0.8;
      const m2 = Math.max(0, 1 - Math.hypot(dx2, dy2) * 3.2) * heightScale * 0.7;
      h += m1 + m2;
      // Riverbed: carve a snaking low strip down the middle
      const riverX = 0.5 + 0.18 * Math.sin(v * Math.PI * 2.3);
      const riverDist = Math.abs(u - riverX);
      const river = Math.max(0, 1 - riverDist * 30) * -heightScale * 0.5;
      h += river;
      // Flatten near spawn corners (player at u~0.15,v~0.85; enemy at u~0.85,v~0.15)
      const sp1 = Math.hypot(u - 0.15, v - 0.85);
      const sp2 = Math.hypot(u - 0.85, v - 0.15);
      const flat1 = Math.max(0, 1 - sp1 * 5);
      const flat2 = Math.max(0, 1 - sp2 * 5);
      const flatten = Math.max(flat1, flat2);
      h = h * (1 - flatten * 0.85);
      // Slightly above water at spawn areas
      if (flatten > 0.6) h = Math.max(h, waterLevel + 0.5);
      heights[i] = h;
    }
  }

  // Apply heights to geometry
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < vertCount; i++) {
    pos.setY(i, heights[i]);
  }
  geo.computeVertexNormals();

  // Compute splat weights per vertex based on height + slope
  const normal = new THREE.Vector3();
  for (let zi = 0; zi <= segs; zi++) {
    for (let xi = 0; xi <= segs; xi++) {
      const i = zi * (segs + 1) + xi;
      const h = heights[i];
      // Slope via finite differences
      const hl = heights[zi * (segs + 1) + Math.max(0, xi - 1)];
      const hr = heights[zi * (segs + 1) + Math.min(segs, xi + 1)];
      const ht = heights[Math.max(0, zi - 1) * (segs + 1) + xi];
      const hb = heights[Math.min(segs, zi + 1) * (segs + 1) + xi];
      const dx = (hr - hl) * 0.5;
      const dz = (hb - ht) * 0.5;
      const slope = Math.hypot(dx, dz);
      normal.set(-dx, 1, -dz).normalize();
      // Weights
      let g = 0, d = 0, r = 0, s = 0;
      if (h < waterLevel + 0.6) {
        // shoreline
        s = 0.7; d = 0.2; g = 0.1;
      } else if (slope > 0.55) {
        // steep = rock
        r = 0.85; d = 0.1; g = 0.05;
      } else if (h > heightScale * 0.7) {
        // peaks = rock
        r = 0.6; g = 0.3; d = 0.1;
      } else if (h > heightScale * 0.4) {
        // mid elevations = grass with some dirt
        g = 0.7; d = 0.2; r = 0.1;
      } else {
        // lowlands = mostly grass
        g = 0.85; d = 0.15;
      }
      // Slight noise to break the banding
      const n = valueNoise2D(xi * 0.3, zi * 0.3, baseSeed + 999) - 0.5;
      g = Math.max(0, g + n * 0.15);
      d = Math.max(0, d - n * 0.05);
      const total = g + d + r + s || 1;
      splat[i * 4 + 0] = Math.round((d / total) * 255); // R = dirt
      splat[i * 4 + 1] = Math.round((g / total) * 255); // G = grass
      splat[i * 4 + 2] = Math.round((r / total) * 255); // B = rock
      splat[i * 4 + 3] = Math.round((s / total) * 255); // A = sand
    }
  }

  // --- Vertex colors based on biome (grass/dirt/rock/sand) ---
  // Reliable approach: bake the splat weights into vertex colors.
  // MeshStandardMaterial with vertexColors=true blends these with the map texture.
  const colors = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    const wD = splat[i * 4 + 0] / 255; // dirt
    const wG = splat[i * 4 + 1] / 255; // grass
    const wR = splat[i * 4 + 2] / 255; // rock
    const wS = splat[i * 4 + 3] / 255; // sand
    // Terrain palette (linear-ish, will be tone-mapped by ACES)
    // grass: (0.22, 0.38, 0.12)  dirt: (0.32, 0.22, 0.12)  rock: (0.38, 0.36, 0.32)  sand: (0.78, 0.68, 0.45)
    colors[i * 3 + 0] = wG * 0.22 + wD * 0.32 + wR * 0.38 + wS * 0.78;
    colors[i * 3 + 1] = wG * 0.38 + wD * 0.22 + wR * 0.36 + wS * 0.68;
    colors[i * 3 + 2] = wG * 0.12 + wD * 0.12 + wR * 0.32 + wS * 0.45;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Use a single tiled grass texture for subtle detail, multiplied by vertex colors.
  // This is robust — no onBeforeCompile shader patching that can break across three.js versions.
  const tex = getTextures();
  // Keep repeat modest so the detail is visible but not noisy
  tex.grass.map.repeat.set(60, 60);
  tex.grass.normalMap.repeat.set(60, 60);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex.grass.map,
    normalMap: tex.grass.normalMap,
    roughness: 0.95,
    metalness: 0.0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  // Disable frustum culling — the heightmap displacement can make the
  // auto-computed bounding sphere inaccurate, causing the terrain to be
  // incorrectly culled from view.
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Water plane at y = waterLevel
  const waterGeo = new THREE.PlaneGeometry(MAP_SIZE * 1.1, MAP_SIZE * 1.1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x2c5a7c,
    metalness: 0.1,
    roughness: 0.25,
    transmission: 0.0, // avoid expensive transmission pass
    transparent: true,
    opacity: 0.78,
    envMapIntensity: 1.0,
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.frustumCulled = false;
  waterMesh.position.y = waterLevel;
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);

  // Helper: getHeightAt(worldX, worldZ) — bilinear sample
  // MUST be defined before the skirt code below (which calls it).
  const half = MAP_SIZE / 2;
  const cellSize = MAP_SIZE / segs;
  function getHeightAt(x: number, z: number): number {
    const u = (x + half) / MAP_SIZE;
    const v = (z + half) / MAP_SIZE;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const fx = u * segs;
    const fz = v * segs;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const i00 = iz * (segs + 1) + Math.min(segs, ix);
    const i10 = iz * (segs + 1) + Math.min(segs, ix + 1);
    const i01 = Math.min(segs, iz + 1) * (segs + 1) + Math.min(segs, ix);
    const i11 = Math.min(segs, iz + 1) * (segs + 1) + Math.min(segs, ix + 1);
    const h00 = heights[i00];
    const h10 = heights[i10];
    const h01 = heights[i01];
    const h11 = heights[i11];
    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - tz) + b * tz;
  }

  function isWaterAt(x: number, z: number): boolean {
    return getHeightAt(x, z) < waterLevel;
  }

  // --- Ground skirt: vertical walls around the terrain edges ---
  // This prevents the "floating island" look by giving the terrain
  // visible depth — like a solid block of earth, not a thin plane.
  const skirtDepth = 30; // how far down the skirt goes
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x5a4030, roughness: 0.95, // dark dirt/earth color
  });
  const skirtRockMat = new THREE.MeshStandardMaterial({
    color: 0x4a4038, roughness: 0.95, // rocky earth
  });

  // Sample the terrain edge heights to build the skirt
  const edgeSamples = 64;
  const halfMap = MAP_SIZE / 2;

  // Build 4 skirt walls (N, S, E, W) as custom geometries
  const buildSkirtWall = (side: 'N' | 'S' | 'E' | 'W', wallMat: THREE.Material) => {
    const positions: number[] = [];
    const indices: number[] = [];
    let idx = 0;

    for (let i = 0; i <= edgeSamples; i++) {
      const t = i / edgeSamples;
      let x: number, z: number;
      if (side === 'N') { x = -halfMap + t * MAP_SIZE; z = -halfMap; }
      else if (side === 'S') { x = -halfMap + t * MAP_SIZE; z = halfMap; }
      else if (side === 'E') { x = halfMap; z = -halfMap + t * MAP_SIZE; }
      else { x = -halfMap; z = -halfMap + t * MAP_SIZE; } // W

      const topY = getHeightAt(x, z);
      // Top vertex
      positions.push(x, topY, z);
      // Bottom vertex (deep below)
      positions.push(x, topY - skirtDepth, z);
      idx += 2;

      // Build quad with previous
      if (i > 0) {
        const a = idx - 4, b = idx - 3, c = idx - 2, d = idx - 1;
        // Flip winding based on side so normals face outward
        if (side === 'N' || side === 'W') {
          indices.push(a, b, c, b, d, c);
        } else {
          indices.push(a, c, b, b, c, d);
        }
      }
    }

    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    skirtGeo.setIndex(indices);
    skirtGeo.computeVertexNormals();
    const wall = new THREE.Mesh(skirtGeo, wallMat);
    wall.frustumCulled = false;
    return wall;
  };

  const sides: ['N' | 'S' | 'E' | 'W', THREE.Material][] = [
    ['N', skirtMat], ['S', skirtRockMat], ['E', skirtMat], ['W', skirtRockMat],
  ];
  sides.forEach(([side, mat]) => {
    scene.add(buildSkirtWall(side, mat));
  });

  // --- Bottom "underground" plane ---
  // A large dark plane below the terrain so you don't see sky through the bottom
  const bottomGeo = new THREE.PlaneGeometry(MAP_SIZE * 1.2, MAP_SIZE * 1.2);
  bottomGeo.rotateX(Math.PI / 2);
  const bottomMat = new THREE.MeshStandardMaterial({
    color: 0x2a1a10, roughness: 1.0,
  });
  const bottomMesh = new THREE.Mesh(bottomGeo, bottomMat);
  bottomMesh.position.y = -skirtDepth;
  bottomMesh.frustumCulled = false;
  scene.add(bottomMesh);

  // --- Distant mountain range ---
  // Detailed mountains with displaced geometry, vertex-color snow caps,
  // and proper grounding (base extends below terrain level).
  const mountainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92, metalness: 0.0,
    flatShading: true,
  });

  /**
   * Build a detailed mountain with vertex colors for snow caps.
   * The cone is displaced with noise for rocky detail, and vertices
   * near the top get white (snow) colors while lower vertices get
   * rocky grey colors. This ensures snow is perfectly aligned because
   * it's the same geometry, not a separate mesh.
   */
  const buildMountain = (
    radius: number, height: number, detail: number,
    seed: number, hasSnow: boolean,
  ): THREE.Mesh => {
    const geo = new THREE.ConeGeometry(radius, height, 8, detail);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);

    // Noise function
    const noise = (x: number, y: number, z: number) => {
      const n = Math.sin(x * 2.1 + seed) * Math.cos(y * 1.7 + seed * 1.3) * Math.sin(z * 2.3 + seed * 0.7);
      const n2 = Math.sin(x * 4.5 + seed * 2) * Math.cos(z * 5.2 + seed * 1.7) * 0.5;
      return n + n2;
    };

    // Color palette
    const rockDark = [0.22, 0.27, 0.32];
    const rockMid = [0.32, 0.37, 0.42];
    const rockLight = [0.42, 0.47, 0.52];
    const snowColor = [0.94, 0.96, 0.98];

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      // Displace outward for rocky detail
      const heightFactor = (y + height / 2) / height; // 0 at bottom, 1 at top
      const disp = noise(x, y, z) * (0.12 + heightFactor * 0.28) * radius;
      const len = Math.hypot(x, z) || 1;
      const nx = x / len, nz = z / len;
      pos.setX(i, x + nx * disp);
      pos.setZ(i, z + nz * disp);
      pos.setY(i, y + noise(x * 0.5, y * 0.5, z * 0.5) * height * 0.04);

      // Vertex color: snow on top, rock below
      const snowLine = hasSnow ? 0.55 : 2.0; // if no snow, snowLine is impossibly high
      if (heightFactor > snowLine) {
        // Snow — blend based on height and noise for natural snow line
        const snowBlend = Math.min(1, (heightFactor - snowLine) / 0.3);
        const noiseVal = noise(x * 0.3, y * 0.3, z * 0.3) * 0.5 + 0.5;
        const useSnow = snowBlend * noiseVal > 0.4;
        if (useSnow) {
          colors[i * 3] = snowColor[0];
          colors[i * 3 + 1] = snowColor[1];
          colors[i * 3 + 2] = snowColor[2];
        } else {
          colors[i * 3] = rockLight[0];
          colors[i * 3 + 1] = rockLight[1];
          colors[i * 3 + 2] = rockLight[2];
        }
      } else if (heightFactor > 0.3) {
        colors[i * 3] = rockMid[0];
        colors[i * 3 + 1] = rockMid[1];
        colors[i * 3 + 2] = rockMid[2];
      } else {
        colors[i * 3] = rockDark[0];
        colors[i * 3 + 1] = rockDark[1];
        colors[i * 3 + 2] = rockDark[2];
      }
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mountainMat);
    m.frustumCulled = false;
    return m;
  };

  // Mountain ring — placed OUTSIDE the playable area so they don't
  // overlap trees/buildings. The map is MAP_SIZE (360) across, so the
  // edge is at ±180. Mountains are placed at radius 0.72+ so their
  // inner edge (center - radius) is well outside the terrain.
  const mountainRingRadius = MAP_SIZE * 0.72; // ~260 units (outside the 180 terrain edge)
  const mountainCount = 40;
  for (let i = 0; i < mountainCount; i++) {
    const angle = (i / mountainCount) * Math.PI * 2;
    const r = mountainRingRadius + (Math.random() - 0.5) * 30;
    const mx = Math.cos(angle) * r;
    const mz = Math.sin(angle) * r;

    const isLargePeak = Math.random() > 0.4;
    // Tall enough to fill the horizon from far away
    const mHeight = isLargePeak ? 120 + Math.random() * 80 : 60 + Math.random() * 50;
    const mRadius = isLargePeak ? 30 + Math.random() * 25 : 18 + Math.random() * 18;
    const detail = isLargePeak ? 5 : 4;
    const hasSnow = mHeight > 100;

    const m = buildMountain(mRadius, mHeight, detail, i * 17.3, hasSnow);
    // Ground: base at y=-10 (below terrain), so cone center = base + height/2
    m.position.set(mx, mHeight * 0.5 - 10, mz);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.castShadow = false;
    m.receiveShadow = false;
    scene.add(m);

    // Secondary peak
    if (isLargePeak && Math.random() > 0.5) {
      const sAngle = angle + (Math.random() - 0.5) * 0.15;
      const sR = r + (Math.random() - 0.5) * 15;
      const sx = Math.cos(sAngle) * sR;
      const sz = Math.sin(sAngle) * sR;
      const sHeight = mHeight * (0.5 + Math.random() * 0.3);
      const sRadius = mRadius * 0.7;
      const sM = buildMountain(sRadius, sHeight, 4, i * 23.7 + 5, sHeight > 55);
      sM.position.set(sx, sHeight * 0.5 - 10, sz);
      sM.rotation.y = Math.random() * Math.PI * 2;
      sM.frustumCulled = false;
      scene.add(sM);
    }
  }

  // --- Foreground hills ---
  const hillMat = new THREE.MeshStandardMaterial({
    color: 0x3a5a3a, roughness: 0.95, flatShading: true,
  });
  const hillMat2 = new THREE.MeshStandardMaterial({
    color: 0x4a6a3a, roughness: 0.95, flatShading: true,
  });
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2 + Math.random() * 0.1;
    const r = MAP_SIZE * 0.51 + Math.random() * 12;
    const hx = Math.cos(angle) * r;
    const hz = Math.sin(angle) * r;
    const hHeight = 8 + Math.random() * 12;
    const hRadius = 10 + Math.random() * 8;
    const hGeo = new THREE.IcosahedronGeometry(hRadius, 1);
    const hpos = hGeo.attributes.position as THREE.BufferAttribute;
    for (let j = 0; j < hpos.count; j++) {
      hpos.setY(j, hpos.getY(j) * 0.4);
    }
    hGeo.computeVertexNormals();
    const hill = new THREE.Mesh(hGeo, i % 2 === 0 ? hillMat : hillMat2);
    // Ground hills at base level too
    hill.position.set(hx, hHeight * 0.3 - 5, hz);
    hill.rotation.y = Math.random() * Math.PI * 2;
    hill.castShadow = false;
    hill.receiveShadow = false;
    hill.frustumCulled = false;
    scene.add(hill);
  }

  // Decorative scattered rocks (low-poly)
  const terrainGroup = new THREE.Group();
  terrainGroup.name = 'terrainGroup';
  // Note: mesh and waterMesh are already added to the scene above.
  // Don't reparent them into terrainGroup (that would remove them from the scene).
  // terrainGroup is kept for potential future use but stays empty.
  scene.add(terrainGroup);

  return {
    mesh,
    heights,
    splat,
    getHeightAt,
    isWaterAt,
    waterMesh,
    terrainGroup,
  };
}
