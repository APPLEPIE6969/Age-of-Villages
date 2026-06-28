// ============================================================================
// Game constants: balance, ages, unit/building stats, resource costs.
// ============================================================================

export const TILE = 2; // world units per terrain tile
export const MAP_TILES = 180; // 180x180 tile map
export const MAP_SIZE = MAP_TILES * TILE; // 360 world units across
export const TILE_RES = 4; // terrain geometry segments per tile (for height detail)

// ---- Resources -------------------------------------------------------------
export type ResourceType = 'wood' | 'food' | 'gold' | 'stone';

export interface ResourceCost {
  wood?: number;
  food?: number;
  gold?: number;
  stone?: number;
}

// ---- Ages ------------------------------------------------------------------
export type Age = 'dark' | 'feudal' | 'castle' | 'imperial';
export const AGE_ORDER: Age[] = ['dark', 'feudal', 'castle', 'imperial'];

export const AGE_INFO: Record<Age, {
  label: string;
  advanceCost: ResourceCost;
  advanceTime: number; // seconds
  color: string;
}> = {
  dark:     { label: 'Dark Age',     advanceCost: { food: 400 },                              advanceTime: 30, color: '#8b6f47' },
  feudal:   { label: 'Feudal Age',   advanceCost: { food: 800,  gold: 200 },                    advanceTime: 45, color: '#b8995c' },
  castle:   { label: 'Castle Age',   advanceCost: { food: 1000, gold: 500,  stone: 200 },       advanceTime: 60, color: '#d4af37' },
  imperial: { label: 'Imperial Age', advanceCost: { food: 1500, gold: 800,  stone: 400 },       advanceTime: 90, color: '#f5e6a8' },
};

// ---- Units -----------------------------------------------------------------
export type UnitType =
  | 'villager'
  | 'militia'      // dark-age infantry
  | 'man_at_arms'  // feudal infantry
  | 'long_swordsman' // castle infantry
  | 'two_handed_swordsman' // imperial infantry
  | 'archer'       // feudal ranged
  | 'crossbowman'  // castle ranged
  | 'arbalester'   // imperial ranged
  | 'scout'        // dark cavalry
  | 'knight'       // castle cavalry
  | 'cavalier'     // imperial cavalry
  | 'ram';         // siege

export interface UnitStats {
  type: UnitType;
  label: string;
  hp: number;
  damage: number;
  attackRange: number; // world units (1.2 = melee)
  attackSpeed: number; // seconds between attacks
  moveSpeed: number;   // world units / sec
  cost: ResourceCost;
  buildTime: number;   // seconds
  popCost: number;
  armor: number;       // flat reduction
  age: Age;
  category: 'worker' | 'infantry' | 'archer' | 'cavalry' | 'siege';
  // damage bonus vs categories (multiplier)
  bonusVs?: Partial<Record<'infantry' | 'archer' | 'cavalry' | 'siege' | 'worker' | 'building', number>>;
  projectile?: boolean;
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  villager: {
    type: 'villager', label: 'Villager', hp: 40, damage: 4, attackRange: 1.4,
    attackSpeed: 1.6, moveSpeed: 7, cost: { food: 50 }, buildTime: 8, popCost: 1,
    armor: 0, age: 'dark', category: 'worker', bonusVs: { building: 0.5 },
  },
  militia: {
    type: 'militia', label: 'Militia', hp: 55, damage: 6, attackRange: 1.4,
    attackSpeed: 1.4, moveSpeed: 7, cost: { food: 60, gold: 20 }, buildTime: 12,
    popCost: 1, armor: 1, age: 'dark', category: 'infantry',
  },
  man_at_arms: {
    type: 'man_at_arms', label: 'Man-at-Arms', hp: 90, damage: 9, attackRange: 1.4,
    attackSpeed: 1.3, moveSpeed: 7, cost: { food: 80, gold: 30 }, buildTime: 16,
    popCost: 1, armor: 2, age: 'feudal', category: 'infantry',
  },
  long_swordsman: {
    type: 'long_swordsman', label: 'Long Swordsman', hp: 130, damage: 13, attackRange: 1.4,
    attackSpeed: 1.2, moveSpeed: 7, cost: { food: 100, gold: 50 }, buildTime: 20,
    popCost: 1, armor: 4, age: 'castle', category: 'infantry',
  },
  two_handed_swordsman: {
    type: 'two_handed_swordsman', label: 'Two-Handed Swordsman', hp: 170, damage: 18, attackRange: 1.4,
    attackSpeed: 1.1, moveSpeed: 7.5, cost: { food: 120, gold: 70 }, buildTime: 24,
    popCost: 1, armor: 5, age: 'imperial', category: 'infantry',
  },
  archer: {
    type: 'archer', label: 'Archer', hp: 45, damage: 7, attackRange: 14,
    attackSpeed: 1.6, moveSpeed: 7, cost: { wood: 25, gold: 45 }, buildTime: 14,
    popCost: 1, armor: 0, age: 'feudal', category: 'archer', projectile: true,
    bonusVs: { infantry: 1.0 },
  },
  crossbowman: {
    type: 'crossbowman', label: 'Crossbowman', hp: 60, damage: 11, attackRange: 16,
    attackSpeed: 1.8, moveSpeed: 6.8, cost: { wood: 35, gold: 60 }, buildTime: 18,
    popCost: 1, armor: 0, age: 'castle', category: 'archer', projectile: true,
  },
  arbalester: {
    type: 'arbalester', label: 'Arbalester', hp: 80, damage: 16, attackRange: 18,
    attackSpeed: 1.7, moveSpeed: 6.8, cost: { wood: 40, gold: 80 }, buildTime: 22,
    popCost: 1, armor: 1, age: 'imperial', category: 'archer', projectile: true,
  },
  scout: {
    type: 'scout', label: 'Scout Cavalry', hp: 70, damage: 6, attackRange: 1.4,
    attackSpeed: 1.3, moveSpeed: 12, cost: { food: 80 }, buildTime: 16,
    popCost: 1, armor: 1, age: 'dark', category: 'cavalry',
    bonusVs: { worker: 1.5 },
  },
  knight: {
    type: 'knight', label: 'Knight', hp: 130, damage: 14, attackRange: 1.4,
    attackSpeed: 1.2, moveSpeed: 11, cost: { food: 100, gold: 60 }, buildTime: 22,
    popCost: 1, armor: 3, age: 'castle', category: 'cavalry',
    bonusVs: { archer: 1.4 },
  },
  cavalier: {
    type: 'cavalier', label: 'Cavalier', hp: 180, damage: 20, attackRange: 1.4,
    attackSpeed: 1.1, moveSpeed: 11.5, cost: { food: 130, gold: 80 }, buildTime: 26,
    popCost: 1, armor: 4, age: 'imperial', category: 'cavalry',
  },
  ram: {
    type: 'ram', label: 'Battering Ram', hp: 220, damage: 50, attackRange: 2.0,
    attackSpeed: 3.0, moveSpeed: 5, cost: { wood: 160, gold: 75 }, buildTime: 30,
    popCost: 2, armor: 0, age: 'castle', category: 'siege',
    bonusVs: { building: 5.0 },
  },
};

// ---- Buildings -------------------------------------------------------------
export type BuildingType =
  | 'town_center'
  | 'house'
  | 'barracks'
  | 'archery_range'
  | 'stable'
  | 'siege_workshop'
  | 'storage'
  | 'tower'
  | 'wall';

export interface BuildingStats {
  type: BuildingType;
  label: string;
  hp: number;
  cost: ResourceCost;
  buildTime: number; // seconds
  popProvided: number; // pop cap increase
  footprint: [number, number]; // tiles wide/deep
  age: Age;
  produces?: UnitType[];
  garrisonCapacity?: number;
  attack?: { damage: number; range: number; speed: number };
}

export const BUILDING_STATS: Record<BuildingType, BuildingStats> = {
  town_center: {
    type: 'town_center', label: 'Town Center', hp: 2400,
    cost: { wood: 350 }, buildTime: 60, popProvided: 10,
    footprint: [4, 4], age: 'dark',
    produces: ['villager'],
    garrisonCapacity: 15,
    attack: { damage: 8, range: 16, speed: 2.0 },
  },
  house: {
    type: 'house', label: 'House', hp: 350,
    cost: { wood: 30 }, buildTime: 10, popProvided: 5,
    footprint: [2, 2], age: 'dark',
  },
  barracks: {
    type: 'barracks', label: 'Barracks', hp: 1200,
    cost: { wood: 150 }, buildTime: 25, popProvided: 0,
    footprint: [3, 3], age: 'dark',
    produces: ['militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman'],
  },
  archery_range: {
    type: 'archery_range', label: 'Archery Range', hp: 1200,
    cost: { wood: 175 }, buildTime: 28, popProvided: 0,
    footprint: [3, 3], age: 'feudal',
    produces: ['archer', 'crossbowman', 'arbalester'],
  },
  stable: {
    type: 'stable', label: 'Stable', hp: 1200,
    cost: { wood: 175 }, buildTime: 28, popProvided: 0,
    footprint: [3, 3], age: 'feudal',
    produces: ['scout', 'knight', 'cavalier'],
  },
  siege_workshop: {
    type: 'siege_workshop', label: 'Siege Workshop', hp: 1200,
    cost: { wood: 200 }, buildTime: 30, popProvided: 0,
    footprint: [3, 3], age: 'castle',
    produces: ['ram'],
  },
  storage: {
    type: 'storage', label: 'Storage Pit', hp: 500,
    cost: { wood: 100 }, buildTime: 18, popProvided: 0,
    footprint: [2, 2], age: 'dark',
  },
  tower: {
    type: 'tower', label: 'Watch Tower', hp: 1000,
    cost: { wood: 50, stone: 125 }, buildTime: 20, popProvided: 0,
    footprint: [1, 1], age: 'feudal',
    garrisonCapacity: 5,
    attack: { damage: 10, range: 14, speed: 1.8 },
  },
  wall: {
    type: 'wall', label: 'Wall', hp: 1500,
    cost: { stone: 5 }, buildTime: 4, popProvided: 0,
    footprint: [1, 1], age: 'feudal',
  },
};

// ---- Population ------------------------------------------------------------
export const BASE_POP_CAP = 5;
export const HARD_POP_CAP = 200;

// ---- Resources on map ------------------------------------------------------
export const RESOURCE_AMOUNTS = {
  tree: 100,
  gold_ore: 800,
  berry_bush: 200,
  stone_rock: 600,
} as const;

export const GATHER_RATES = {
  wood: 0.7,    // per sec
  food: 0.6,
  gold: 0.5,
  stone: 0.45,
} as const;

export const VILLAGER_CARRY = 10; // max carry before deposit
