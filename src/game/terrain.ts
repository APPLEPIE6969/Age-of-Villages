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

  // Build a splat texture from the per-vertex weights (downsampled to a manageable size)
  const splatSize = MAP_TILES + 1;
  const splatCanvas = document.createElement('canvas');
  splatCanvas.width = splatCanvas.height = splatSize;
  const sctx = splatCanvas.getContext('2d')!;
  const simg = sctx.createImageData(splatSize, splatSize);
  for (let i = 0; i < vertCount; i++) {
    simg.data[i * 4 + 0] = splat[i * 4 + 0];
    simg.data[i * 4 + 1] = splat[i * 4 + 1];
    simg.data[i * 4 + 2] = splat[i * 4 + 2];
    simg.data[i * 4 + 3] = splat[i * 4 + 3];
  }
  sctx.putImageData(simg, 0, 0);
  const splatTex = new THREE.CanvasTexture(splatCanvas);
  splatTex.wrapS = splatTex.wrapT = THREE.ClampToEdgeWrapping;
  splatTex.colorSpace = THREE.LinearSRGBColorSpace;

  // Build material with custom splat shader via onBeforeCompile
  const tex = getTextures();
  // Repeat wrapping for the tiled PBR textures
  [tex.grass, tex.dirt, tex.rock, tex.sand].forEach(set => {
    set.map.repeat.set(48, 48);
    set.normalMap.repeat.set(48, 48);
    set.roughnessMap?.repeat.set(48, 48);
  });

  const mat = new THREE.MeshStandardMaterial({
    map: tex.grass.map,
    normalMap: tex.grass.normalMap,
    roughnessMap: tex.grass.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
  });

  mat.onBeforeCompile = (shader) => {
    // Add uniforms for splat map + 3 extra textures
    shader.uniforms.splatMap = { value: splatTex };
    shader.uniforms.map2 = { value: tex.dirt.map };
    shader.uniforms.map3 = { value: tex.rock.map };
    shader.uniforms.map4 = { value: tex.sand.map };
    shader.uniforms.normalMap2 = { value: tex.dirt.normalMap };
    shader.uniforms.normalMap3 = { value: tex.rock.normalMap };
    shader.uniforms.normalMap4 = { value: tex.sand.normalMap };
    shader.uniforms.roughnessMap2 = { value: tex.dirt.roughnessMap };
    shader.uniforms.roughnessMap3 = { value: tex.rock.roughnessMap };
    shader.uniforms.roughnessMap4 = { value: tex.sand.roughnessMap };

    // ---- Vertex shader ----
    // Pass through world UV (UV1 already 0..1 across the plane). We need
    // a high-frequency UV for the tiled textures (UV * 48) and the splat UV (UV itself).
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec2 vHighUv;   // tiled UV (0..48)
        varying vec2 vSplatUv;  // splat UV (0..1)
      `)
      .replace('#include <uv_vertex>', `
        #include <uv_vertex>
        vHighUv = uv * 48.0;
        vSplatUv = uv;
      `);

    // ---- Fragment shader ----
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform sampler2D splatMap;
        uniform sampler2D map2; uniform sampler2D map3; uniform sampler2D map4;
        uniform sampler2D normalMap2; uniform sampler2D normalMap3; uniform sampler2D normalMap4;
        uniform sampler2D roughnessMap2; uniform sampler2D roughnessMap3; uniform sampler2D roughnessMap4;
        varying vec2 vHighUv;
        varying vec2 vSplatUv;
      `)
      // Replace the map_fragment chunk to do 4-way splat blend
      .replace('#include <map_fragment>', `
        vec4 splat = texture2D(splatMap, vSplatUv);
        float wG = splat.g;
        float wD = splat.r;
        float wR = splat.b;
        float wS = splat.a;
        // Normalize (in case weights don't sum to 1 due to noise)
        float sumW = wG + wD + wR + wS + 0.0001;
        wG /= sumW; wD /= sumW; wR /= sumW; wS /= sumW;
        vec4 colG = texture2D(map, vHighUv);
        vec4 colD = texture2D(map2, vHighUv);
        vec4 colR = texture2D(map3, vHighUv);
        vec4 colS = texture2D(map4, vHighUv);
        diffuseColor = colG * wG + colD * wD + colR * wR + colS * wS;
      `)
      // Replace normal_fragment to blend normal maps
      .replace('#include <normal_fragment_maps>', `
        vec3 nG = texture2D(normalMap, vHighUv).rgb * 2.0 - 1.0;
        vec3 nD = texture2D(normalMap2, vHighUv).rgb * 2.0 - 1.0;
        vec3 nR = texture2D(normalMap3, vHighUv).rgb * 2.0 - 1.0;
        vec3 nS = texture2D(normalMap4, vHighUv).rgb * 2.0 - 1.0;
        vec3 blended = nG * wG + nD * wD + nR * wR + nS * wS;
        normal = perturbNormal2Arb(-vViewPosition, normal, blended, faceDirection);
      `)
      // Replace roughness_map_fragment to blend roughness maps
      .replace('#include <roughnessmap_fragment>', `
        float rG = texture2D(roughnessMap, vHighUv).g;
        float rD = texture2D(roughnessMap2, vHighUv).g;
        float rR = texture2D(roughnessMap3, vHighUv).g;
        float rS = texture2D(roughnessMap4, vHighUv).g;
        float roughnessFactor = rG * wG + rD * wD + rR * wR + rS * wS;
        roughnessFactor *= roughnessFactor; // square for better range
      `);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
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
  waterMesh.position.y = waterLevel;
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);

  // Helper: getHeightAt(worldX, worldZ) — bilinear sample
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

  // Decorative scattered rocks (low-poly)
  const terrainGroup = new THREE.Group();
  terrainGroup.name = 'terrainGroup';
  terrainGroup.add(mesh);
  terrainGroup.add(waterMesh);

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
