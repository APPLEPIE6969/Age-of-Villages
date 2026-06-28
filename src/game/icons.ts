// ============================================================================
// Icon generator: renders each unit/building mesh to a small preview image.
// Creates a temporary offscreen renderer, frames each mesh with a 3/4 camera,
// captures the pixels to a canvas, and returns a data URL.
// ============================================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildUnitMesh, buildBuildingMesh } from './models';
import { UnitType, BuildingType } from './constants';

const ICON_SIZE = 96;

let iconRenderer: THREE.WebGLRenderer | null = null;
let iconScene: THREE.Scene | null = null;
let iconCamera: THREE.PerspectiveCamera | null = null;
let iconPmrem: THREE.PMREMGenerator | null = null;

function ensureIconRenderer() {
  if (iconRenderer) return;
  iconRenderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  iconRenderer.setPixelRatio(1);
  iconRenderer.setSize(ICON_SIZE, ICON_SIZE);
  iconRenderer.outputColorSpace = THREE.SRGBColorSpace;
  iconRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  iconRenderer.toneMappingExposure = 1.1;
  iconRenderer.shadowMap.enabled = false;

  iconScene = new THREE.Scene();
  // Soft neutral lighting for the icons
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(3, 5, 4);
  iconScene.add(key);
  const fill = new THREE.HemisphereLight(0xbcd8ff, 0x4a3826, 0.7);
  iconScene.add(fill);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  iconScene.add(ambient);

  // Environment map for nice PBR reflections
  iconPmrem = new THREE.PMREMGenerator(iconRenderer);
  iconScene.environment = iconPmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  iconCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
}

/**
 * Render a mesh to a data URL.
 * Frames the mesh using its bounding box to compute the right camera distance.
 */
function renderMeshToIcon(mesh: THREE.Group, opts: {
  angle?: number;      // yaw rotation of the mesh
  pitch?: number;      // camera pitch (0 = ground level, PI/2 = top-down)
  zoom?: number;       // 1.0 = fit, larger = closer
}): string {
  ensureIconRenderer();
  if (!iconRenderer || !iconScene || !iconCamera) return '';

  // Clear the scene of previous meshes (keep lights + env)
  const toRemove: THREE.Object3D[] = [];
  for (const child of iconScene.children) {
    if (!(child instanceof THREE.Light)) toRemove.push(child);
  }
  toRemove.forEach(o => iconScene!.remove(o));

  // Clone the mesh so we don't disturb the original
  const clone = mesh.clone(true);
  clone.rotation.y = opts.angle ?? Math.PI * 0.25;
  iconScene.add(clone);

  // Compute bounding box to frame the mesh
  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // If the mesh is empty, bail
  if (size.length() === 0) return '';

  const maxDim = Math.max(size.x, size.y, size.z);
  const fitDist = maxDim / (2 * Math.tan((iconCamera.fov * Math.PI / 180) / 2));
  const dist = fitDist * (opts.zoom ?? 1.2);

  const pitch = opts.pitch ?? 0.45; // ~26° from horizontal — nice 3/4 view
  // Position camera at an angle around the mesh
  iconCamera.position.set(
    center.x + dist * Math.cos(pitch) * Math.sin(0.6),
    center.y + dist * Math.sin(pitch) + size.y * 0.1,
    center.z + dist * Math.cos(pitch) * Math.cos(0.6),
  );
  iconCamera.lookAt(center.x, center.y + size.y * 0.05, center.z);

  // Render
  iconRenderer.clear();
  iconRenderer.render(iconScene, iconCamera);

  // Read pixels to a canvas
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);

  // Draw the renderer's canvas
  ctx.drawImage(iconRenderer.domElement, 0, 0);

  // Add a subtle radial gradient background behind the mesh (so it's not pure transparent)
  // Actually, transparent is better for UI blending. Skip the background.

  return canvas.toDataURL('image/png');
}

// --- Caches ---
const unitIconCache = new Map<UnitType, string>();
const buildingIconCache = new Map<BuildingType, string>();

export function getUnitIcon(type: UnitType, team: 'player' | 'enemy' = 'player'): string {
  const key = `${type}_${team}`;
  // Cache by type only (team doesn't drastically change the silhouette)
  if (unitIconCache.has(type)) return unitIconCache.get(type)!;
  const mesh = buildUnitMesh(type, team);
  // Remove the selection ring and HP bar from the icon
  mesh.traverse(o => {
    if (o.name === 'selectionRing' || o.name === 'hpBar' || o.name === 'hpBarBg' || o.name === 'hpBarFg') {
      o.visible = false;
    }
  });
  // Per-unit-type camera tweaks for best framing
  const opts: { angle?: number; pitch?: number; zoom?: number } = {};
  switch (type) {
    case 'villager': opts.zoom = 1.3; opts.pitch = 0.5; break;
    case 'militia':
    case 'man_at_arms':
    case 'long_swordsman':
    case 'two_handed_swordsman':
      opts.zoom = 1.15; opts.pitch = 0.5; break;
    case 'archer':
    case 'crossbowman':
    case 'arbalester':
      opts.zoom = 1.2; opts.pitch = 0.5; break;
    case 'scout':
    case 'knight':
    case 'cavalier':
      opts.zoom = 1.0; opts.pitch = 0.55; break;
    case 'ram':
      opts.zoom = 1.1; opts.pitch = 0.6; break;
  }
  const url = renderMeshToIcon(mesh, opts);
  unitIconCache.set(type, url);
  return url;
}

export function getBuildingIcon(type: BuildingType, team: 'player' | 'enemy' = 'player'): string {
  if (buildingIconCache.has(type)) return buildingIconCache.get(type)!;
  const mesh = buildBuildingMesh(type, team);
  // Remove selection ring + HP bar + scaffold
  mesh.traverse(o => {
    if (o.name === 'selectionRing' || o.name === 'hpBar' || o.name === 'hpBarBg' || o.name === 'hpBarFg' || o.name === 'scaffold') {
      o.visible = false;
    }
  });
  const opts: { angle?: number; pitch?: number; zoom?: number } = {};
  switch (type) {
    case 'town_center': opts.zoom = 1.0; opts.pitch = 0.5; break;
    case 'house': opts.zoom = 1.2; opts.pitch = 0.55; break;
    case 'barracks': opts.zoom = 1.1; opts.pitch = 0.55; break;
    case 'archery_range': opts.zoom = 1.1; opts.pitch = 0.55; break;
    case 'stable': opts.zoom = 1.05; opts.pitch = 0.6; break;
    case 'siege_workshop': opts.zoom = 1.1; opts.pitch = 0.6; break;
    case 'storage': opts.zoom = 1.2; opts.pitch = 0.55; break;
    case 'tower': opts.zoom = 1.0; opts.pitch = 0.45; break;
    case 'wall': opts.zoom = 1.3; opts.pitch = 0.55; break;
  }
  const url = renderMeshToIcon(mesh, opts);
  buildingIconCache.set(type, url);
  return url;
}

// Pre-generate all icons (called once at startup)
export function pregenerateIcons() {
  const units: UnitType[] = [
    'villager', 'militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman',
    'archer', 'crossbowman', 'arbalester',
    'scout', 'knight', 'cavalier',
    'ram',
  ];
  const buildings: BuildingType[] = [
    'town_center', 'house', 'barracks', 'archery_range', 'stable',
    'siege_workshop', 'storage', 'tower', 'wall',
  ];
  units.forEach(u => getUnitIcon(u));
  buildings.forEach(b => getBuildingIcon(b));
}

// Clean up (called on engine dispose)
export function disposeIcons() {
  if (iconRenderer) {
    iconRenderer.dispose();
    iconRenderer.forceContextLoss();
    iconRenderer = null;
  }
  if (iconPmrem) {
    iconPmrem.dispose();
    iconPmrem = null;
  }
  iconScene = null;
  iconCamera = null;
  unitIconCache.clear();
  buildingIconCache.clear();
}
