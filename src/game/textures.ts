// ============================================================================
// Procedural PBR textures generated via canvas + value-noise.
// Produces grass / dirt / rock / sand color + normal maps, plus a generic
// wood and metal texture for buildings, and team-color accents.
// All textures are 256x256 (tileable) — small enough to keep memory low,
// large enough to look good when tiled at 24x on a 360-unit terrain.
// ============================================================================

import * as THREE from 'three';

// Deterministic 2D value noise with smoothstep interpolation.
function makeNoise(seed: number) {
  // Hashed RNG
  const rand = (x: number, y: number) => {
    const n = Math.sin((x * 12.9898 + y * 78.233 + seed * 43.21) * 1.0) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const a = rand(ix, iy);
    const b = rand(ix + 1, iy);
    const c = rand(ix, iy + 1);
    const d = rand(ix + 1, iy + 1);
    const ux = smooth(fx), uy = smooth(fy);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy)
         + c * (1 - ux) * uy + d * ux * uy;
  };
}

function fbm(noise: (x: number, y: number) => number, octaves: number) {
  return (x: number, y: number) => {
    let sum = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y * freq);
      freq *= 2; amp *= 0.5;
    }
    return sum;
  };
}

function createCanvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function canvasToTexture(c: HTMLCanvasElement, srgb = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// Convert heightmap array (0..1) into a normal map by Sobel filter.
function heightToNormalCanvas(heights: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const c = createCanvas(size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const get = (x: number, y: number) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = get(x - 1, y - 1), t = get(x, y - 1), tr = get(x + 1, y - 1);
      const l = get(x - 1, y),                 r = get(x + 1, y);
      const bl = get(x - 1, y + 1), b = get(x, y + 1), br = get(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i]     = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface PBRTextureSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

// --- Grass ---
function makeGrass(): PBRTextureSet {
  const size = 256;
  const noise = makeNoise(7);
  const f = fbm(noise, 5);
  const color = createCanvas(size);
  const rough = createCanvas(size);
  const height = new Float32Array(size * size);
  const ctx = color.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const cimg = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = f(x * 0.08, y * 0.08);
      const blade = Math.random() < 0.04 ? 0.4 : 0; // sparse blade highlights
      const v = n + blade;
      const g = 60 + v * 80;
      const i = (y * size + x) * 4;
      cimg.data[i]     = 38 + n * 28;
      cimg.data[i + 1] = g;
      cimg.data[i + 2] = 26 + n * 18;
      cimg.data[i + 3] = 255;
      rimg.data[i]     = 200 + n * 40;
      rimg.data[i + 1] = rimg.data[i];
      rimg.data[i + 2] = rimg.data[i];
      rimg.data[i + 3] = 255;
      height[y * size + x] = v;
    }
  }
  ctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: canvasToTexture(color),
    normalMap: canvasToTexture(heightToNormalCanvas(height, size, 2.5), false),
    roughnessMap: canvasToTexture(rough, false),
  };
}

// --- Dirt ---
function makeDirt(): PBRTextureSet {
  const size = 256;
  const noise = makeNoise(23);
  const f = fbm(noise, 5);
  const color = createCanvas(size);
  const rough = createCanvas(size);
  const height = new Float32Array(size * size);
  const ctx = color.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const cimg = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = f(x * 0.06, y * 0.06);
      const v = n;
      const i = (y * size + x) * 4;
      cimg.data[i]     = 95 + v * 40;
      cimg.data[i + 1] = 70 + v * 30;
      cimg.data[i + 2] = 45 + v * 20;
      cimg.data[i + 3] = 255;
      rimg.data[i]     = 220 - n * 30;
      rimg.data[i + 1] = rimg.data[i];
      rimg.data[i + 2] = rimg.data[i];
      rimg.data[i + 3] = 255;
      height[y * size + x] = v * 0.6;
    }
  }
  ctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: canvasToTexture(color),
    normalMap: canvasToTexture(heightToNormalCanvas(height, size, 2.0), false),
    roughnessMap: canvasToTexture(rough, false),
  };
}

// --- Rock ---
function makeRock(): PBRTextureSet {
  const size = 256;
  const noise = makeNoise(41);
  const f = fbm(noise, 6);
  const color = createCanvas(size);
  const rough = createCanvas(size);
  const height = new Float32Array(size * size);
  const ctx = color.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const cimg = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = f(x * 0.09, y * 0.09);
      const crack = Math.abs(Math.sin(x * 0.31 + n * 8)) < 0.05 ? -0.3 : 0;
      const v = n + crack;
      const i = (y * size + x) * 4;
      cimg.data[i]     = 110 + v * 50;
      cimg.data[i + 1] = 108 + v * 48;
      cimg.data[i + 2] = 100 + v * 40;
      cimg.data[i + 3] = 255;
      rimg.data[i]     = 200 + n * 30;
      rimg.data[i + 1] = rimg.data[i];
      rimg.data[i + 2] = rimg.data[i];
      rimg.data[i + 3] = 255;
      height[y * size + x] = v;
    }
  }
  ctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: canvasToTexture(color),
    normalMap: canvasToTexture(heightToNormalCanvas(height, size, 3.0), false),
    roughnessMap: canvasToTexture(rough, false),
  };
}

// --- Sand ---
function makeSand(): PBRTextureSet {
  const size = 256;
  const noise = makeNoise(13);
  const f = fbm(noise, 4);
  const color = createCanvas(size);
  const rough = createCanvas(size);
  const height = new Float32Array(size * size);
  const ctx = color.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const cimg = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = f(x * 0.05, y * 0.05);
      const i = (y * size + x) * 4;
      cimg.data[i]     = 200 + n * 35;
      cimg.data[i + 1] = 180 + n * 30;
      cimg.data[i + 2] = 130 + n * 25;
      cimg.data[i + 3] = 255;
      rimg.data[i]     = 235;
      rimg.data[i + 1] = 235;
      rimg.data[i + 2] = 235;
      rimg.data[i + 3] = 255;
      height[y * size + x] = n * 0.3;
    }
  }
  ctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: canvasToTexture(color),
    normalMap: canvasToTexture(heightToNormalCanvas(height, size, 1.0), false),
    roughnessMap: canvasToTexture(rough, false),
  };
}

// --- Wood (for buildings) ---
function makeWood(): PBRTextureSet {
  const size = 256;
  const noise = makeNoise(2);
  const color = createCanvas(size);
  const rough = createCanvas(size);
  const height = new Float32Array(size * size);
  const ctx = color.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const cimg = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // vertical planks
      const plank = Math.floor(x / 32);
      const offset = plank * 13;
      const ring = Math.sin((y + offset) * 0.15) * 0.5 + 0.5;
      const n = noise(x * 0.2, (y + offset) * 0.05) * 0.3;
      const v = ring * 0.6 + n + 0.1;
      const dark = plank % 2 === 0 ? 1.0 : 0.85;
      const i = (y * size + x) * 4;
      cimg.data[i]     = (110 + v * 50) * dark;
      cimg.data[i + 1] = (75 + v * 35) * dark;
      cimg.data[i + 2] = (45 + v * 22) * dark;
      cimg.data[i + 3] = 255;
      rimg.data[i]     = 220;
      rimg.data[i + 1] = 220;
      rimg.data[i + 2] = 220;
      rimg.data[i + 3] = 255;
      height[y * size + x] = v * 0.5;
    }
  }
  ctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: canvasToTexture(color),
    normalMap: canvasToTexture(heightToNormalCanvas(height, size, 1.5), false),
    roughnessMap: canvasToTexture(rough, false),
  };
}

// --- Stone (for buildings) ---
function makeStone(): PBRTextureSet {
  const size = 256;
  const noise = makeNoise(31);
  const f = fbm(noise, 5);
  const color = createCanvas(size);
  const rough = createCanvas(size);
  const height = new Float32Array(size * size);
  const ctx = color.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const cimg = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // block pattern
      const bx = Math.floor(x / 64);
      const by = Math.floor(y / 32);
      const offset = (by % 2) * 32;
      const blockX = Math.floor((x + offset) / 64);
      const edge = ((x + offset) % 64 < 2) || (y % 32 < 2) ? -0.3 : 0;
      const n = f(x * 0.07, y * 0.07);
      const v = n + edge;
      const blockShade = (blockX + by) % 2 === 0 ? 1.0 : 0.9;
      const i = (y * size + x) * 4;
      cimg.data[i]     = (135 + v * 30) * blockShade;
      cimg.data[i + 1] = (132 + v * 28) * blockShade;
      cimg.data[i + 2] = (125 + v * 25) * blockShade;
      cimg.data[i + 3] = 255;
      rimg.data[i]     = 230;
      rimg.data[i + 1] = 230;
      rimg.data[i + 2] = 230;
      rimg.data[i + 3] = 255;
      height[y * size + x] = v;
    }
  }
  ctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: canvasToTexture(color),
    normalMap: canvasToTexture(heightToNormalCanvas(height, size, 2.0), false),
    roughnessMap: canvasToTexture(rough, false),
  };
}

// --- Metal (for weapons/armor) ---
function makeMetal(): PBRTextureSet {
  const size = 128;
  const noise = makeNoise(17);
  const color = createCanvas(size);
  const rough = createCanvas(size);
  const height = new Float32Array(size * size);
  const ctx = color.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const cimg = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.15, y * 0.15);
      const scratch = Math.abs(Math.sin(y * 0.4 + n * 4)) < 0.06 ? 0.3 : 0;
      const v = n + scratch;
      const i = (y * size + x) * 4;
      cimg.data[i]     = 120 + v * 80;
      cimg.data[i + 1] = 120 + v * 80;
      cimg.data[i + 2] = 135 + v * 80;
      cimg.data[i + 3] = 255;
      rimg.data[i]     = 90 + n * 40;
      rimg.data[i + 1] = rimg.data[i];
      rimg.data[i + 2] = rimg.data[i];
      rimg.data[i + 3] = 255;
      height[y * size + x] = v * 0.4;
    }
  }
  ctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: canvasToTexture(color),
    normalMap: canvasToTexture(heightToNormalCanvas(height, size, 1.5), false),
    roughnessMap: canvasToTexture(rough, false),
  };
}

// --- Cloth (for tents/capes) ---
function makeCloth(): PBRTextureSet {
  const size = 128;
  const noise = makeNoise(5);
  const f = fbm(noise, 3);
  const color = createCanvas(size);
  const rough = createCanvas(size);
  const height = new Float32Array(size * size);
  const ctx = color.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const cimg = ctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = (Math.sin(x * 1.5) + Math.sin(y * 1.5)) * 0.1;
      const n = f(x * 0.2, y * 0.2) + weave;
      const i = (y * size + x) * 4;
      cimg.data[i]     = 200 + n * 30;
      cimg.data[i + 1] = 200 + n * 30;
      cimg.data[i + 2] = 200 + n * 30;
      cimg.data[i + 3] = 255;
      rimg.data[i]     = 240;
      rimg.data[i + 1] = 240;
      rimg.data[i + 2] = 240;
      rimg.data[i + 3] = 255;
      height[y * size + x] = n * 0.3;
    }
  }
  ctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: canvasToTexture(color),
    normalMap: canvasToTexture(heightToNormalCanvas(height, size, 1.0), false),
    roughnessMap: canvasToTexture(rough, false),
  };
}

let cached: {
  grass: PBRTextureSet;
  dirt: PBRTextureSet;
  rock: PBRTextureSet;
  sand: PBRTextureSet;
  wood: PBRTextureSet;
  stone: PBRTextureSet;
  metal: PBRTextureSet;
  cloth: PBRTextureSet;
} | null = null;

export function getTextures() {
  if (cached) return cached;
  cached = {
    grass: makeGrass(),
    dirt: makeDirt(),
    rock: makeRock(),
    sand: makeSand(),
    wood: makeWood(),
    stone: makeStone(),
    metal: makeMetal(),
    cloth: makeCloth(),
  };
  return cached;
}

// Team color palette - applied as a tint on top of materials
export const TEAM_COLORS = {
  player: 0x4f8cff,  // blue
  enemy: 0xc0392b,    // red
};

// Build a tinted variant of a base color texture by drawing it tinted.
export function tintTexture(base: HTMLCanvasElement, color: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = base.width; c.height = base.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(base, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
