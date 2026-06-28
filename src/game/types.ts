// ============================================================================
// Game state types: units, buildings, resources, projectiles, players.
// ============================================================================

import * as THREE from 'three';
import { UnitType, BuildingType, ResourceType, Age } from './constants';

export type Team = 'player' | 'enemy';

export interface Unit {
  __kind: 'unit';
  id: number;
  type: UnitType;
  team: Team;
  mesh: THREE.Group;
  pos: THREE.Vector3;          // current world position (y = terrain height)
  hp: number;
  maxHp: number;
  // Pathfinding
  path: THREE.Vector3[];       // remaining waypoints (world space, y=0)
  pathTarget: THREE.Vector3 | null;
  // Orders
  order:
    | { kind: 'idle' }
    | { kind: 'move'; target: THREE.Vector3 }
    | { kind: 'attackMove'; target: THREE.Vector3 }
    | { kind: 'attack'; targetId: number }
    | { kind: 'gather'; resourceId: number; phase: 'toResource' | 'gathering' | 'toDrop' | 'dropping'; resourceType: ResourceType }
    | { kind: 'build'; buildingId: number; phase: 'toBuild' | 'building' }
    | { kind: 'returnResource'; dropBuildingId: number };
  carrying: { type: ResourceType; amount: number } | null;
  attackCooldown: number;
  // Visual state
  facing: number; // yaw radians
  velocity: THREE.Vector3;
  bobPhase: number;
  alive: boolean;
  // Combat target acquisition
  lastTargetSearch: number;
  // Animation state
  anim: {
    state: 'idle' | 'walk' | 'attack' | 'gather';
    phase: number;      // animation phase (radians)
    speed: number;      // animation playback speed
    attackTrigger: number;  // counts down during attack swing
    parts: {
      legL?: THREE.Object3D;
      legR?: THREE.Object3D;
      armL?: THREE.Object3D;
      armR?: THREE.Object3D;
      torso?: THREE.Object3D;
      head?: THREE.Object3D;
      tool?: THREE.Object3D;   // weapon/tool
      bow?: THREE.Object3D;
      horse?: THREE.Object3D;
      rider?: THREE.Object3D;
    };
  };
}

export interface Building {
  __kind: 'building';
  id: number;
  type: BuildingType;
  team: Team;
  mesh: THREE.Group;
  pos: THREE.Vector3;       // center, y = terrain height
  hp: number;
  maxHp: number;
  // Construction state
  buildProgress: number;    // 0..1 (1 = complete)
  underConstruction: boolean;
  builders: Set<number>;    // unit ids assigned
  // Production queue
  queue: { unit: UnitType; progress: number; cost: { wood?: number; food?: number; gold?: number } }[];
  rallyPoint: THREE.Vector3 | null;
  // Combat (for towers/TC)
  attackCooldown: number;
  // Footprint in tiles
  footprint: [number, number]; // tiles wide, deep
  age: Age;
  // Name label sprite (shown above building)
  label?: THREE.Sprite;
}

export interface ResourceNode {
  id: number;
  type: ResourceType;
  amount: number;
  maxAmount: number;
  mesh: THREE.Group;
  pos: THREE.Vector3;
  alive: boolean;
}

export interface Projectile {
  id: number;
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;          // 0..1 progress
  speed: number;      // units per sec
  damage: number;
  team: Team;
  targetId: number;   // unit or building id (target.unit = true if unit)
  targetUnit: boolean;
  arc: number;        // height of arc
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
}

export interface Player {
  team: Team;
  resources: { wood: number; food: number; gold: number; stone: number };
  pop: number;
  popCap: number;
  age: Age;
  advancing: { from: Age; to: Age; progress: number; total: number } | null;
  isAI: boolean;
}

export interface Selection {
  units: number[];     // unit ids
  building: number | null; // single building id (or null)
}
