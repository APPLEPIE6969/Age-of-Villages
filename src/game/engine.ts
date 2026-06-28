// ============================================================================
// GameEngine: orchestrates rendering, game state, input, economy, combat, AI.
// ============================================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  TILE, MAP_TILES, MAP_SIZE, BUILDING_STATS, UNIT_STATS, AGE_ORDER, AGE_INFO,
  BASE_POP_CAP, HARD_POP_CAP, GATHER_RATES, VILLAGER_CARRY, RESOURCE_AMOUNTS,
  UnitType, BuildingType, ResourceType, Age, BuildingStats, UnitStats,
} from './constants';
import { buildTerrain, TerrainData } from './terrain';
import {
  buildUnitMesh, buildBuildingMesh, buildTreeMesh, buildGoldOreMesh, buildBerryBushMesh,
} from './models';
import { CameraRig } from './camera';
import { Pathfinder } from './pathfinding';
import { pregenerateIcons, disposeIcons, getUnitIcon, getBuildingIcon } from './icons';
import { createLabelSprite, createTooltipSprite } from './labels';
import {
  Unit, Building, ResourceNode, Projectile, Player, Team,
} from './types';

export interface EngineCallbacks {
  onSelectionChange?: (sel: { unitIds: number[]; buildingId: number | null }) => void;
  onResourcesChange?: (player: Player, enemy: Player) => void;
  onGameOver?: (winner: Team) => void;
  onBuildingPlace?: (active: boolean, type: BuildingType | null) => void;
  onLog?: (msg: string) => void;
}

export class GameEngine {
  // Three.js core
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  clock = new THREE.Clock();
  terrain!: TerrainData;
  cameraRig!: CameraRig;
  pathfinder!: Pathfinder;

  // Game state
  units = new Map<number, Unit>();
  buildings = new Map<number, Building>();
  resources = new Map<number, ResourceNode>();
  projectiles: Projectile[] = [];
  players: Record<Team, Player>;
  nextId = 1;

  // Selection
  selectedUnitIds: number[] = [];
  selectedBuildingId: number | null = null;

  // Input state
  private dom: HTMLElement;
  private mouseDown = false;
  private mouseDownPos = { x: 0, y: 0 };
  private mouseDownButton = 0;
  private dragBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private placingBuilding: BuildingType | null = null;
  private ghostMesh: THREE.Group | null = null;

  // Raycaster
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  // Visual helpers
  private moveMarkers: { mesh: THREE.Mesh; life: number }[] = [];

  // Callbacks
  private cb: EngineCallbacks;

  // Game over
  private gameOver = false;

  // Mobile mode (affects label visibility)
  isMobile = false;

  // Hover tooltip (desktop only)
  private hoverTooltip: THREE.Sprite | null = null;
  private hoveredBuildingId: number | null = null;

  // AI state
  private aiState: {
    nextWaveTimer: number;
    nextBuildTimer: number;
    boomed: boolean;
    armyTarget: THREE.Vector3 | null;
  } = {
    nextWaveTimer: 60,    // first wave at ~1 min
    nextBuildTimer: 5,
    boomed: false,
    armyTarget: null,
  };

  constructor(dom: HTMLElement, cb: EngineCallbacks = {}) {
    this.dom = dom;
    this.cb = cb;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    dom.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    // Scene
    this.scene = new THREE.Scene();
    // Sky — distinct blue
    this.scene.background = new THREE.Color(0x5a7fa5);
    // Fog — warm brown/green so distant terrain reads as "ground" not "sky"
    this.scene.fog = new THREE.Fog(0x7a8060, 350, 700);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.5, 1000,
    );

    // Lighting + env
    this.setupLighting();

    // Players
    this.players = {
      player: {
        team: 'player',
        resources: { wood: 200, food: 200, gold: 100 },
        pop: 0,
        popCap: BASE_POP_CAP,
        age: 'dark',
        advancing: null,
        isAI: false,
      },
      enemy: {
        team: 'enemy',
        resources: { wood: 200, food: 200, gold: 100 },
        pop: 0,
        popCap: BASE_POP_CAP,
        age: 'dark',
        advancing: null,
        isAI: true,
      },
    };
  }

  // --------------------------------------------------------------------------
  // SETUP
  // --------------------------------------------------------------------------
  private setupLighting() {
    // Sun
    const sun = new THREE.DirectionalLight(0xfff4d6, 2.4);
    sun.position.set(80, 130, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera as THREE.OrthographicCamera;
    c.left = -120; c.right = 120; c.top = 120; c.bottom = -120;
    c.near = 0.5; c.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Hemisphere fill
    const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x5a4a32, 0.6);
    this.scene.add(hemi);

    // Ambient low
    const ambient = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(ambient);

    // Environment for PBR
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = env.texture;
  }

  // --------------------------------------------------------------------------
  // INIT GAME WORLD
  // --------------------------------------------------------------------------
  init() {
    this.terrain = buildTerrain(this.scene, 1337);
    this.pathfinder = new Pathfinder();

    // Mark water and steep-slope tiles as blocked
    this.markTerrainObstacles();

    // Spawn resources (forests, gold, berries) scattered, avoiding spawn areas
    this.spawnResources();

    // Spawn player base: TC + 3 villagers
    const playerSpawn = this.worldFromTile(0.15, 0.85);
    const enemySpawn = this.worldFromTile(0.85, 0.15);
    this.spawnStartingBase('player', playerSpawn);
    this.spawnStartingBase('enemy', enemySpawn);

    // Camera initial position over player base, looking toward map center
    this.cameraRig = new CameraRig(this.camera, this.dom, this.terrain.getHeightAt);
    this.cameraRig.focal.set(playerSpawn.x, 0, playerSpawn.z);
    // Player spawn is at (-X, +Z) corner. Camera should be at corner side, looking toward +X, -Z.
    this.cameraRig.yaw = -Math.PI * 0.25;
    // Higher pitch = more top-down so terrain fills the screen (classic RTS view)
    this.cameraRig.pitch = 1.2;  // ~69° from horizontal — nearly top-down
    this.cameraRig.distance = 40;
    this.cameraRig.minDist = 15;
    this.cameraRig.maxDist = 150;
    this.cameraRig.minPitch = 0.5;
    this.cameraRig.maxPitch = 1.35;
    this.cameraRig.update();

    // Resize handler
    window.addEventListener('resize', this.onResize);

    // Input handlers
    this.attachInput();

    // Pre-generate unit/building preview icons for the HUD
    pregenerateIcons();

    // Initial callback
    this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
  }

  /** Get a unit preview icon as a data URL (for HUD buttons) */
  getUnitIconURL(type: UnitType): string { return getUnitIcon(type); }
  /** Get a building preview icon as a data URL (for HUD buttons) */
  getBuildingIconURL(type: BuildingType): string { return getBuildingIcon(type); }

  private worldFromTile(u: number, v: number): THREE.Vector3 {
    const half = MAP_SIZE / 2;
    const x = u * MAP_SIZE - half;
    const z = v * MAP_SIZE - half;
    const y = this.terrain.getHeightAt(x, z);
    return new THREE.Vector3(x, y, z);
  }

  private markTerrainObstacles() {
    const T = MAP_TILES;
    for (let tz = 0; tz < T; tz++) {
      for (let tx = 0; tx < T; tx++) {
        const half = MAP_SIZE / 2;
        const wx = tx * TILE - half + TILE / 2;
        const wz = tz * TILE - half + TILE / 2;
        // Water — blocked
        if (this.terrain.isWaterAt(wx, wz)) {
          this.pathfinder.setBlocked(tx, tz, true);
          continue;
        }
        // Steep slope — blocked
        const dx = this.terrain.getHeightAt(wx + TILE, wz) - this.terrain.getHeightAt(wx - TILE, wz);
        const dz = this.terrain.getHeightAt(wx, wz + TILE) - this.terrain.getHeightAt(wx, wz - TILE);
        const slope = Math.hypot(dx, dz) / (2 * TILE);
        if (slope > 0.7) this.pathfinder.setBlocked(tx, tz, true);
      }
    }
  }

  private spawnResources() {
    const half = MAP_SIZE / 2;
    const T = MAP_TILES;
    // Forests: cluster trees around 10-12 random centers
    const forestCenters: { x: number; z: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const u = 0.08 + Math.random() * 0.84;
      const v = 0.08 + Math.random() * 0.84;
      forestCenters.push({ x: u * MAP_SIZE - half, z: v * MAP_SIZE - half });
    }
    forestCenters.forEach(c => {
      const count = 12 + Math.floor(Math.random() * 12);
      for (let i = 0; i < count; i++) {
        const r = Math.random() * 12;
        const a = Math.random() * Math.PI * 2;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        const y = this.terrain.getHeightAt(x, z);
        if (this.terrain.isWaterAt(x, z)) continue;
        // Don't stack on existing resource
        if (this.resourceAt(x, z, 1.5)) continue;
        const mesh = buildTreeMesh(Math.floor(Math.random() * 100));
        mesh.position.set(x, y, z);
        mesh.rotation.y = Math.random() * Math.PI * 2;
        const scale = 0.85 + Math.random() * 0.3;
        mesh.scale.setScalar(scale);
        this.scene.add(mesh);
        const id = this.nextId++;
        this.resources.set(id, {
          id, type: 'wood', amount: RESOURCE_AMOUNTS.tree, maxAmount: RESOURCE_AMOUNTS.tree,
          mesh, pos: new THREE.Vector3(x, y, z), alive: true,
        });
        // Block pathing on this tile
        const [tx, tz] = this.pathfinder.worldToTile(x, z);
        this.pathfinder.setBlocked(tx, tz, true);
      }
    });

    // Gold ore: ~6 deposits scattered, away from spawn corners
    for (let i = 0; i < 8; i++) {
      const u = 0.1 + Math.random() * 0.8;
      const v = 0.1 + Math.random() * 0.8;
      const x = u * MAP_SIZE - half;
      const z = v * MAP_SIZE - half;
      const y = this.terrain.getHeightAt(x, z);
      if (this.terrain.isWaterAt(x, z)) continue;
      if (this.resourceAt(x, z, 4)) continue;
      const mesh = buildGoldOreMesh();
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      const id = this.nextId++;
      this.resources.set(id, {
        id, type: 'gold', amount: RESOURCE_AMOUNTS.gold_ore, maxAmount: RESOURCE_AMOUNTS.gold_ore,
        mesh, pos: new THREE.Vector3(x, y, z), alive: true,
      });
      // Block a 2x2 area
      const [tx, tz] = this.pathfinder.worldToTile(x, z);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        this.pathfinder.setBlocked(tx + dx, tz + dz, true);
      }
    }

    // Berry bushes near each spawn area for early food
    const spawns = [
      this.worldFromTile(0.15, 0.85),
      this.worldFromTile(0.85, 0.15),
    ];
    spawns.forEach(spawn => {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const x = spawn.x + Math.cos(a) * 10;
        const z = spawn.z + Math.sin(a) * 10;
        const y = this.terrain.getHeightAt(x, z);
        if (this.terrain.isWaterAt(x, z)) continue;
        const mesh = buildBerryBushMesh();
        mesh.position.set(x, y, z);
        this.scene.add(mesh);
        const id = this.nextId++;
        this.resources.set(id, {
          id, type: 'food', amount: RESOURCE_AMOUNTS.berry_bush, maxAmount: RESOURCE_AMOUNTS.berry_bush,
          mesh, pos: new THREE.Vector3(x, y, z), alive: true,
        });
      }
    });
  }

  private resourceAt(x: number, z: number, radius: number): boolean {
    for (const r of this.resources.values()) {
      if (r.pos.distanceTo(new THREE.Vector3(x, 0, z)) < radius) return true;
    }
    return false;
  }

  private spawnStartingBase(team: Team, pos: THREE.Vector3) {
    // Town Center
    const tc = this.createBuilding('town_center', team, pos.clone(), false);
    tc.buildProgress = 1;
    tc.underConstruction = false;
    tc.hp = tc.maxHp;
    // Hide scaffold
    const scaffold = tc.mesh.getObjectByName('scaffold');
    if (scaffold) scaffold.visible = false;

    // Update pathfinder — block TC footprint
    this.blockBuildingFootprint(tc);

    // 3 villagers near TC
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const vx = pos.x + Math.cos(a) * 5;
      const vz = pos.z + Math.sin(a) * 5;
      const vy = this.terrain.getHeightAt(vx, vz);
      this.createUnit('villager', team, new THREE.Vector3(vx, vy, vz));
    }

    // Scout (free) for early exploration
    const sa = Math.random() * Math.PI * 2;
    const sx = pos.x + Math.cos(sa) * 7;
    const sz = pos.z + Math.sin(sa) * 7;
    const sy = this.terrain.getHeightAt(sx, sz);
    this.createUnit('scout', team, new THREE.Vector3(sx, sy, sz));
  }

  // --------------------------------------------------------------------------
  // FACTORY: create unit / building
  // --------------------------------------------------------------------------
  createUnit(type: UnitType, team: Team, pos: THREE.Vector3): Unit | null {
    const stats = UNIT_STATS[type];
    const player = this.players[team];
    // Check pop cap & cost (only for player — AI is unlimited by cost but respects pop cap)
    if (player.pop + stats.popCost > player.popCap) {
      if (team === 'player') this.cb.onLog?.('Population cap reached. Build more houses.');
      return null;
    }
    // Deduct resources if player (AI uses its own resource logic)
    if (team === 'player' || team === 'enemy') {
      const r = player.resources;
      if ((stats.cost.wood || 0) > r.wood || (stats.cost.food || 0) > r.food || (stats.cost.gold || 0) > r.gold) {
        return null;
      }
    }
    // Create mesh
    const mesh = buildUnitMesh(type, team);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    const id = this.nextId++;
    // Find animation parts by name
    const findPart = (name: string) => mesh.getObjectByName(name);
    const unit: Unit = {
      __kind: 'unit',
      id, type, team, mesh,
      pos: pos.clone(),
      hp: stats.hp,
      maxHp: stats.hp,
      path: [],
      pathTarget: null,
      order: { kind: 'idle' },
      carrying: null,
      attackCooldown: 0,
      facing: 0,
      velocity: new THREE.Vector3(),
      bobPhase: Math.random() * Math.PI * 2,
      alive: true,
      lastTargetSearch: 0,
      anim: {
        state: 'idle',
        phase: Math.random() * Math.PI * 2,
        speed: 1,
        attackTrigger: 0,
        parts: {
          legL: findPart('legL'),
          legR: findPart('legR'),
          armL: findPart('armL'),
          armR: findPart('armR'),
          tool: findPart('tool'),
        },
      },
    };
    this.units.set(id, unit);
    player.pop += stats.popCost;
    if (team === 'player') this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
    return unit;
  }

  // Spend resources for a unit (called by building production queue)
  private spendForUnit(team: Team, type: UnitType): boolean {
    const stats = UNIT_STATS[type];
    const r = this.players[team].resources;
    if ((stats.cost.wood || 0) > r.wood) return false;
    if ((stats.cost.food || 0) > r.food) return false;
    if ((stats.cost.gold || 0) > r.gold) return false;
    r.wood -= stats.cost.wood || 0;
    r.food -= stats.cost.food || 0;
    r.gold -= stats.cost.gold || 0;
    return true;
  }

  // Refund (when queue is cancelled)
  private refundForUnit(team: Team, type: UnitType) {
    const stats = UNIT_STATS[type];
    const r = this.players[team].resources;
    r.wood += stats.cost.wood || 0;
    r.food += stats.cost.food || 0;
    r.gold += stats.cost.gold || 0;
  }

  createBuilding(
    type: BuildingType, team: Team, pos: THREE.Vector3, underConstruction = true
  ): Building {
    const stats = BUILDING_STATS[type];
    const mesh = buildBuildingMesh(type, team);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    const id = this.nextId++;
    const b: Building = {
      __kind: 'building',
      id, type, team, mesh,
      pos: pos.clone(),
      hp: underConstruction ? Math.max(1, stats.hp * 0.1) : stats.hp,
      maxHp: stats.hp,
      buildProgress: underConstruction ? 0 : 1,
      underConstruction,
      builders: new Set(),
      queue: [],
      rallyPoint: null,
      attackCooldown: 0,
      footprint: stats.footprint,
      age: stats.age,
    };

    // Create name label above building
    const labelHeight = type === 'town_center' ? 6 : type === 'tower' ? 6 : type === 'wall' ? 3.5 : 3.2;
    const label = createLabelSprite(stats.label, {
      fontSize: 28,
      color: '#ffffff',
      bgColor: team === 'player' ? '#1a3060' : '#401818',
      bgOpacity: 0.75,
    });
    label.position.set(0, labelHeight, 0);
    label.name = 'buildingLabel';
    mesh.add(label);
    b.label = label;

    this.buildings.set(id, b);

    // Show scaffold if under construction; hide until complete
    const scaffold = mesh.getObjectByName('scaffold');
    if (scaffold) scaffold.visible = underConstruction;
    // Hide main mesh pieces while scaffold is shown (except the scaffold itself + rings + hp bars)
    mesh.children.forEach(c => {
      if (c.name === 'scaffold' || c.name === 'selectionRing' || c.name === 'hpBar' || c.name === 'buildingLabel') return;
      c.visible = !underConstruction;
    });
    // Hide label while under construction
    label.visible = !underConstruction;

    // Update pop cap if applicable
    this.updatePopCap(team);
    if (team === 'player') this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
    return b;
  }

  private updatePopCap(team: Team) {
    const player = this.players[team];
    let cap = BASE_POP_CAP;
    for (const b of this.buildings.values()) {
      if (b.team === team && !b.underConstruction) {
        cap += BUILDING_STATS[b.type].popProvided;
      }
    }
    player.popCap = Math.min(cap, HARD_POP_CAP);
  }

  private blockBuildingFootprint(b: Building) {
    const [tx0, tz0] = this.pathfinder.worldToTile(b.pos.x, b.pos.z);
    const [w, d] = b.footprint;
    const hw = Math.floor(w / 2);
    const hd = Math.floor(d / 2);
    for (let dx = -hw; dx <= hw; dx++) {
      for (let dz = -hd; dz <= hd; dz++) {
        this.pathfinder.setBlocked(tx0 + dx, tz0 + dz, true);
      }
    }
  }

  private unblockBuildingFootprint(b: Building) {
    const [tx0, tz0] = this.pathfinder.worldToTile(b.pos.x, b.pos.z);
    const [w, d] = b.footprint;
    const hw = Math.floor(w / 2);
    const hd = Math.floor(d / 2);
    for (let dx = -hw; dx <= hw; dx++) {
      for (let dz = -hd; dz <= hd; dz++) {
        // Only unblock if no other building overlaps
        let occupied = false;
        for (const ob of this.buildings.values()) {
          if (ob.id === b.id) continue;
          const [otx, otz] = this.pathfinder.worldToTile(ob.pos.x, ob.pos.z);
          const [ow, od] = ob.footprint;
          const ohw = Math.floor(ow / 2);
          const ohd = Math.floor(od / 2);
          if (Math.abs(otx - (tx0 + dx)) <= ohw && Math.abs(otz - (tz0 + dz)) <= ohd) {
            occupied = true; break;
          }
        }
        if (!occupied) this.pathfinder.setBlocked(tx0 + dx, tz0 + dz, false);
      }
    }
  }

  // --------------------------------------------------------------------------
  // INPUT
  // --------------------------------------------------------------------------
  private attachInput() {
    const el = this.renderer.domElement;
    el.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    el.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('contextmenu', this.onContext);
    // Touch — one-finger selection (tap=click, drag=box-select, long-press=command menu)
    el.addEventListener('touchstart', this.onTouchStart, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    el.addEventListener('touchend', this.onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  private onContext = (e: Event) => e.preventDefault();

  // --- Touch state for one-finger selection ---
  private touchStartPos = { x: 0, y: 0, time: 0 };
  private touchActive = false;
  private touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  private touchLongPressFired = false;
  private touchCurrentPos = { x: 0, y: 0 };
  private touchDragBox: { x0: number; y0: number; x1: number; y1: number } | null = null;

  private onTouchStart = (e: TouchEvent) => {
    if (this.gameOver) return;
    // Only handle one-finger touches (two-finger = camera rig handles pan/zoom/rotate)
    if (e.touches.length !== 1) {
      // Two fingers started — cancel any ongoing one-finger gesture
      this.touchActive = false;
      if (this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = null;
      }
      this.touchDragBox = null;
      return;
    }
    const t = e.touches[0];
    this.touchActive = true;
    this.touchLongPressFired = false;
    this.touchStartPos = { x: t.clientX, y: t.clientY, time: Date.now() };
    this.touchCurrentPos = { x: t.clientX, y: t.clientY };
    // If placing a building, handle on touchend (tap)
    if (!this.placingBuilding) {
      // Start a potential drag-box
      this.touchDragBox = { x0: t.clientX, y0: t.clientY, x1: t.clientX, y1: t.clientY };
    }
    // Long-press = right-click (issue command to current selection at touch point)
    this.touchLongPressTimer = setTimeout(() => {
      if (this.touchActive) {
        this.touchLongPressFired = true;
        this.touchDragBox = null;
        this.simulateRightClick(this.touchStartPos.x, this.touchStartPos.y);
      }
    }, 450);
  };

  private onTouchMove = (e: TouchEvent) => {
    if (!this.touchActive || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    this.touchCurrentPos = { x: t.clientX, y: t.clientY };
    const dx = Math.abs(t.clientX - this.touchStartPos.x);
    const dy = Math.abs(t.clientY - this.touchStartPos.y);
    // Cancel long-press if finger moved too much
    if ((dx > 10 || dy > 10) && this.touchLongPressTimer) {
      clearTimeout(this.touchLongPressTimer);
      this.touchLongPressTimer = null;
    }
    // Update drag box (for box-select)
    if (this.touchDragBox && !this.touchLongPressFired) {
      this.touchDragBox.x1 = t.clientX;
      this.touchDragBox.y1 = t.clientY;
    }
    // If placing building, move ghost
    if (this.placingBuilding && this.ghostMesh) {
      this.updateNDC({ clientX: t.clientX, clientY: t.clientY } as MouseEvent);
      const point = this.pickTerrain();
      if (point) {
        const y = this.terrain.getHeightAt(point.x, point.z);
        this.ghostMesh.position.set(point.x, y, point.z);
        this.ghostMesh.visible = true;
        const valid = this.canPlaceBuildingAt(this.placingBuilding, point);
        this.ghostMesh.traverse(o => {
          if (o instanceof THREE.Mesh) {
            const mat = o.material as THREE.MeshBasicMaterial;
            mat.color.setHex(valid ? 0x33ff66 : 0xff3333);
          }
        });
      }
    }
  };

  private onTouchEnd = (e: TouchEvent) => {
    if (!this.touchActive) return;
    this.touchActive = false;
    if (this.touchLongPressTimer) {
      clearTimeout(this.touchLongPressTimer);
      this.touchLongPressTimer = null;
    }
    // If long-press already fired, don't also do a tap action
    if (this.touchLongPressFired) {
      this.touchDragBox = null;
      return;
    }
    const dx = Math.abs(this.touchCurrentPos.x - this.touchStartPos.x);
    const dy = Math.abs(this.touchCurrentPos.y - this.touchStartPos.y);
    const moved = dx > 10 || dy > 10;

    if (this.placingBuilding) {
      // Tap = place building
      if (!moved) {
        this.simulateLeftClick(this.touchCurrentPos.x, this.touchCurrentPos.y);
      }
      this.touchDragBox = null;
      return;
    }

    if (!moved) {
      // Tap = click select
      this.simulateLeftClick(this.touchCurrentPos.x, this.touchCurrentPos.y);
    } else if (this.touchDragBox) {
      // Drag = box select
      this.handleBoxSelect(this.touchDragBox);
    }
    this.touchDragBox = null;
  };

  // Synthesize a left-click at screen coords (for touch tap)
  private simulateLeftClick(x: number, y: number) {
    this.updateNDC({ clientX: x, clientY: y } as MouseEvent);
    const pick = this.pickUnitOrBuilding();
    if (pick) {
      if (pick.kind === 'unit') {
        const u = this.units.get(pick.id)!;
        this.selectUnits([u.id]);
      } else if (pick.kind === 'building') {
        const b = this.buildings.get(pick.id)!;
        this.selectBuilding(b.id);
      } else {
        this.deselectAll();
      }
    } else {
      this.deselectAll();
    }
  }

  // Synthesize a right-click at screen coords (for touch long-press)
  private simulateRightClick(x: number, y: number) {
    if (this.selectedUnitIds.length === 0 && this.selectedBuildingId === null) return;
    this.updateNDC({ clientX: x, clientY: y } as MouseEvent);
    const pick = this.pickUnitOrBuilding();
    const point = this.pickTerrain();
    if (!point) return;
    if (this.selectedUnitIds.length > 0) {
      if (pick) {
        if (pick.kind === 'unit') {
          const target = this.units.get(pick.id)!;
          if (target.team !== 'player') {
            this.commandAttack(pick.id);
            this.spawnMoveMarker(target.pos, 0xff3333);
            return;
          }
        } else if (pick.kind === 'resource') {
          this.commandGather(pick.id);
          const r = this.resources.get(pick.id);
          if (r) this.spawnMoveMarker(r.pos, 0xffaa33);
          return;
        } else if (pick.kind === 'building') {
          const b = this.buildings.get(pick.id)!;
          if (b.underConstruction && b.team === 'player') {
            this.commandBuild(pick.id);
            this.spawnMoveMarker(b.pos, 0xffaa33);
            return;
          }
          if (b.team !== 'player') {
            this.commandAttackBuilding(pick.id);
            this.spawnMoveMarker(b.pos, 0xff3333);
            return;
          }
          // Friendly building: drop off / move
          for (const id of this.selectedUnitIds) {
            const u = this.units.get(id);
            if (!u) continue;
            if (u.carrying) {
              u.order = { kind: 'returnResource', dropBuildingId: b.id };
              this.pathTo(u, b.pos);
            } else {
              u.order = { kind: 'move', target: b.pos.clone() };
              this.pathTo(u, b.pos);
            }
          }
          return;
        }
      }
      this.commandMove(point);
      this.spawnMoveMarker(point, 0x33ff66);
    } else if (this.selectedBuildingId !== null) {
      const b = this.buildings.get(this.selectedBuildingId);
      if (b && b.team === 'player' && !b.underConstruction) {
        b.rallyPoint = point.clone();
        this.spawnMoveMarker(point, 0x33aaff);
      }
    }
  }

  private updateNDC(e: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.gameOver) return;
    this.mouseDown = true;
    this.mouseDownButton = e.button;
    this.mouseDownPos = { x: e.clientX, y: e.clientY };
    if (e.button === 0) {
      // If placing a building, attempt placement on left click
      if (this.placingBuilding) {
        this.updateNDC(e);
        const point = this.pickTerrain();
        if (point && this.canPlaceBuildingAt(this.placingBuilding, point)) {
          this.placeBuilding(this.placingBuilding, point);
        }
        return;
      }
      // Start drag-select
      this.dragBox = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.mouseDown) {
      // Update ghost position when placing
      if (this.placingBuilding && this.ghostMesh) {
        this.updateNDC(e);
        const point = this.pickTerrain();
        if (point) {
          const y = this.terrain.getHeightAt(point.x, point.z);
          this.ghostMesh.position.set(point.x, y, point.z);
          this.ghostMesh.visible = true;
          const valid = this.canPlaceBuildingAt(this.placingBuilding, point);
          this.ghostMesh.traverse(o => {
            if (o instanceof THREE.Mesh) {
              const mat = o.material as THREE.MeshBasicMaterial;
              mat.color.setHex(valid ? 0x33ff66 : 0xff3333);
            }
          });
        }
      }
      // Desktop hover tooltip on buildings (mobile shows labels always)
      if (!this.isMobile && !this.placingBuilding) {
        this.updateNDC(e);
        this.updateHoverTooltip();
      }
      return;
    }
    if (this.mouseDownButton === 0 && this.dragBox) {
      this.dragBox.x1 = e.clientX;
      this.dragBox.y1 = e.clientY;
    }
  };

  /** Update the desktop hover tooltip — shows detailed info when hovering a building */
  private updateHoverTooltip() {
    const pick = this.pickUnitOrBuilding();
    const buildingId = pick && pick.kind === 'building' ? pick.id : null;

    if (buildingId === this.hoveredBuildingId) return; // no change

    // Remove old tooltip
    if (this.hoverTooltip) {
      this.scene.remove(this.hoverTooltip);
      this.hoverTooltip = null;
    }
    this.hoveredBuildingId = buildingId;

    if (buildingId !== null) {
      const b = this.buildings.get(buildingId);
      if (b) {
        const stats = BUILDING_STATS[b.type];
        const lines: string[] = [stats.label];
        lines.push(`HP: ${Math.ceil(b.hp)}/${b.maxHp}`);
        const costParts: string[] = [];
        if (stats.cost.wood) costParts.push(`${stats.cost.wood}w`);
        if (stats.cost.food) costParts.push(`${stats.cost.food}f`);
        if (stats.cost.gold) costParts.push(`${stats.cost.gold}g`);
        if (costParts.length) lines.push(`Cost: ${costParts.join(' ')}`);
        if (stats.popProvided) lines.push(`Pop: +${stats.popProvided}`);
        if (stats.produces && stats.produces.length) {
          lines.push(`Trains: ${stats.produces.map(u => UNIT_STATS[u].label).join(', ')}`);
        }
        if (stats.attack) lines.push(`Attack: ${stats.attack.damage} dmg`);
        lines.push(`Age: ${AGE_INFO[stats.age].label}`);

        const tooltip = createTooltipSprite(lines, { fontSize: 22 });
        const yOffset = b.type === 'town_center' ? 7 : b.type === 'tower' ? 7 : 5;
        tooltip.position.set(b.pos.x, this.terrain.getHeightAt(b.pos.x, b.pos.z) + yOffset, b.pos.z);
        this.scene.add(tooltip);
        this.hoverTooltip = tooltip;
      }
    }
  }

  private onMouseUp = (e: MouseEvent) => {
    if (this.gameOver) return;
    if (!this.mouseDown) return;
    this.mouseDown = false;
    if (e.button === 0) {
      if (this.placingBuilding) {
        // Cancel placement on left click without move? No — left click confirms.
        // Already handled in mousedown.
        this.dragBox = null;
        return;
      }
      // Drag-select or click-select
      const dx = Math.abs(e.clientX - this.mouseDownPos.x);
      const dy = Math.abs(e.clientY - this.mouseDownPos.y);
      if (dx < 5 && dy < 5) {
        this.handleClick(e);
      } else if (this.dragBox) {
        this.handleBoxSelect(this.dragBox);
      }
      this.dragBox = null;
    } else if (e.button === 2) {
      // Right click = command
      this.handleRightClick(e);
    }
  };

  private pickTerrain(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    // Intersect terrain plane via ray-plane intersection (terrain mesh also works)
    const hit = this.raycaster.intersectObject(this.terrain.mesh, false)[0];
    if (hit) return hit.point.clone();
    // Fallback: raycast against y=0 plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const out = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, out)) return out;
    return null;
  }

  private pickUnitOrBuilding(): { kind: 'unit'; id: number } | { kind: 'building'; id: number } | { kind: 'resource'; id: number } | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    // Build a list of selectable meshes (units + buildings)
    const objects: THREE.Object3D[] = [];
    for (const u of this.units.values()) {
      if (!u.alive) continue;
      objects.push(u.mesh);
    }
    for (const b of this.buildings.values()) {
      objects.push(b.mesh);
    }
    for (const r of this.resources.values()) {
      if (!r.alive) continue;
      objects.push(r.mesh);
    }
    const hits = this.raycaster.intersectObjects(objects, true);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj) {
      if (obj.userData.unitType) {
        const u = [...this.units.values()].find(u => u.mesh === obj);
        if (u) return { kind: 'unit', id: u.id };
      }
      if (obj.userData.buildingType) {
        const b = [...this.buildings.values()].find(b => b.mesh === obj);
        if (b) return { kind: 'building', id: b.id };
      }
      if (obj.userData.isResource) {
        const r = [...this.resources.values()].find(r => r.mesh === obj);
        if (r) return { kind: 'resource', id: r.id };
      }
      obj = obj.parent;
    }
    return null;
  }

  private handleClick(e: MouseEvent) {
    this.updateNDC(e);
    const pick = this.pickUnitOrBuilding();
    if (pick) {
      if (pick.kind === 'unit') {
        const u = this.units.get(pick.id)!;
        if (u.team === 'player') {
          this.selectUnits([u.id]);
        } else {
          // Select enemy unit (single, for inspection / target preview)
          this.selectUnits([u.id]);
        }
      } else if (pick.kind === 'building') {
        const b = this.buildings.get(pick.id)!;
        this.selectBuilding(b.id);
      } else if (pick.kind === 'resource') {
        // Clicking a resource selects the nearest villager and assigns gather
        // (only if player has villagers idle). Otherwise just deselect.
        this.deselectAll();
      }
    } else {
      this.deselectAll();
    }
  }

  private handleBoxSelect(box: { x0: number; y0: number; x1: number; y1: number }) {
    const x0 = Math.min(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1);
    const x1 = Math.max(box.x0, box.x1);
    const y1 = Math.max(box.y0, box.y1);
    const selected: number[] = [];
    const v = new THREE.Vector3();
    for (const u of this.units.values()) {
      if (u.team !== 'player' || !u.alive) continue;
      v.copy(u.pos).project(this.camera);
      const sx = (v.x + 1) / 2 * window.innerWidth;
      const sy = -(v.y - 1) / 2 * window.innerHeight;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
        selected.push(u.id);
      }
    }
    if (selected.length > 0) {
      this.selectUnits(selected);
    } else {
      // Try to select a building inside the box
      for (const b of this.buildings.values()) {
        if (b.team !== 'player') continue;
        v.copy(b.pos).project(this.camera);
        const sx = (v.x + 1) / 2 * window.innerWidth;
        const sy = -(v.y - 1) / 2 * window.innerHeight;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
          this.selectBuilding(b.id);
          return;
        }
      }
      this.deselectAll();
    }
  }

  private handleRightClick(e: MouseEvent) {
    if (this.selectedUnitIds.length === 0 && this.selectedBuildingId === null) return;
    this.updateNDC(e);
    const pick = this.pickUnitOrBuilding();
    const point = this.pickTerrain();
    if (!point) return;

    if (this.selectedUnitIds.length > 0) {
      // Issue command to selected units
      if (pick) {
        if (pick.kind === 'unit') {
          const target = this.units.get(pick.id)!;
          if (target.team !== 'player') {
            this.commandAttack(pick.id);
            this.spawnMoveMarker(target.pos, 0xff3333);
            return;
          } else {
            // Follow? Just move to point.
          }
        } else if (pick.kind === 'resource') {
          this.commandGather(pick.id);
          const r = this.resources.get(pick.id);
          if (r) this.spawnMoveMarker(r.pos, 0xffaa33);
          return;
        } else if (pick.kind === 'building') {
          const b = this.buildings.get(pick.id)!;
          if (b.underConstruction && b.team === 'player') {
            this.commandBuild(pick.id);
            this.spawnMoveMarker(b.pos, 0xffaa33);
            return;
          }
          if (b.team !== 'player') {
            this.commandAttackBuilding(pick.id);
            this.spawnMoveMarker(b.pos, 0xff3333);
            return;
          }
          // Friendly building: gather/drop-off or move near
          // Treat TC/storage as drop point for villagers carrying resources
          const stats = BUILDING_STATS[b.type];
          if (stats.produces || b.type === 'storage' || b.type === 'town_center') {
            // Right-click on TC = set rally / return resource
            for (const id of this.selectedUnitIds) {
              const u = this.units.get(id);
              if (!u) continue;
              if (u.carrying) {
                u.order = { kind: 'returnResource', dropBuildingId: b.id };
                this.pathTo(u, b.pos);
              } else {
                u.order = { kind: 'move', target: b.pos.clone() };
                this.pathTo(u, b.pos);
              }
            }
            return;
          }
        }
      }
      // Default: move to point
      this.commandMove(point);
      this.spawnMoveMarker(point, 0x33ff66);
    } else if (this.selectedBuildingId !== null) {
      const b = this.buildings.get(this.selectedBuildingId);
      if (b && b.team === 'player' && !b.underConstruction) {
        b.rallyPoint = point.clone();
        this.spawnMoveMarker(point, 0x33aaff);
      }
    }
  }

  // --------------------------------------------------------------------------
  // SELECTION
  // --------------------------------------------------------------------------
  selectUnits(ids: number[]) {
    // Clear previous
    for (const id of this.selectedUnitIds) {
      const u = this.units.get(id);
      if (u) this.setUnitRing(u, false);
    }
    this.selectedBuildingId = null;
    this.selectedUnitIds = ids;
    for (const id of ids) {
      const u = this.units.get(id);
      if (u) this.setUnitRing(u, true);
    }
    this.cb.onSelectionChange?.({ unitIds: ids, buildingId: null });
  }

  selectBuilding(id: number) {
    for (const uid of this.selectedUnitIds) {
      const u = this.units.get(uid);
      if (u) this.setUnitRing(u, false);
    }
    this.selectedUnitIds = [];
    const old = this.selectedBuildingId;
    if (old !== null) {
      const ob = this.buildings.get(old);
      if (ob) this.setBuildingRing(ob, false);
    }
    this.selectedBuildingId = id;
    const b = this.buildings.get(id);
    if (b) this.setBuildingRing(b, true);
    this.cb.onSelectionChange?.({ unitIds: [], buildingId: id });
  }

  deselectAll() {
    for (const id of this.selectedUnitIds) {
      const u = this.units.get(id);
      if (u) this.setUnitRing(u, false);
    }
    if (this.selectedBuildingId !== null) {
      const b = this.buildings.get(this.selectedBuildingId);
      if (b) this.setBuildingRing(b, false);
    }
    this.selectedUnitIds = [];
    this.selectedBuildingId = null;
    this.cb.onSelectionChange?.({ unitIds: [], buildingId: null });
  }

  private setUnitRing(u: Unit, on: boolean) {
    const ring = u.mesh.getObjectByName('selectionRing') as THREE.Mesh;
    if (ring) {
      (ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.85 : 0.0;
      const teamColor = u.team === 'player' ? 0x33ff66 : 0xff6633;
      (ring.material as THREE.MeshBasicMaterial).color.setHex(teamColor);
    }
    const hpBar = u.mesh.getObjectByName('hpBar') as THREE.Group;
    if (hpBar) hpBar.visible = on || u.hp < u.maxHp;
  }

  private setBuildingRing(b: Building, on: boolean) {
    const ring = b.mesh.getObjectByName('selectionRing') as THREE.Mesh;
    if (ring) {
      (ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.85 : 0.0;
      const teamColor = b.team === 'player' ? 0x33ff66 : 0xff6633;
      (ring.material as THREE.MeshBasicMaterial).color.setHex(teamColor);
    }
    const hpBar = b.mesh.getObjectByName('hpBar') as THREE.Group;
    if (hpBar) hpBar.visible = on || b.hp < b.maxHp;
  }

  // --------------------------------------------------------------------------
  // COMMANDS
  // --------------------------------------------------------------------------
  private commandMove(target: THREE.Vector3) {
    const units = this.selectedUnitIds.map(id => this.units.get(id)).filter(Boolean) as Unit[];
    if (units.length === 0) return;
    // Move all to target with simple formation offset
    const formation = this.computeFormation(units.length);
    units.forEach((u, i) => {
      const off = formation[i];
      const dest = target.clone().add(new THREE.Vector3(off[0], 0, off[1]));
      u.order = { kind: 'move', target: dest };
      this.pathTo(u, dest);
    });
  }

  private commandAttackMove(target: THREE.Vector3) {
    const units = this.selectedUnitIds.map(id => this.units.get(id)).filter(Boolean) as Unit[];
    const formation = this.computeFormation(units.length);
    units.forEach((u, i) => {
      const off = formation[i];
      const dest = target.clone().add(new THREE.Vector3(off[0], 0, off[1]));
      u.order = { kind: 'attackMove', target: dest };
      this.pathTo(u, dest);
    });
  }

  private commandAttack(targetId: number) {
    for (const id of this.selectedUnitIds) {
      const u = this.units.get(id);
      if (!u) continue;
      u.order = { kind: 'attack', targetId };
      u.path = [];
    }
  }

  private commandAttackBuilding(targetId: number) {
    for (const id of this.selectedUnitIds) {
      const u = this.units.get(id);
      if (!u) continue;
      u.order = { kind: 'attack', targetId };
      u.path = [];
    }
  }

  private commandGather(resourceId: number) {
    const r = this.resources.get(resourceId);
    if (!r) return;
    for (const id of this.selectedUnitIds) {
      const u = this.units.get(id);
      if (!u) continue;
      if (u.type !== 'villager') {
        // Non-villager: just move there
        u.order = { kind: 'move', target: r.pos.clone() };
        this.pathTo(u, r.pos);
        continue;
      }
      u.order = {
        kind: 'gather',
        resourceId,
        phase: 'toResource',
        resourceType: r.type,
      };
      this.pathTo(u, r.pos);
    }
  }

  private commandBuild(buildingId: number) {
    const b = this.buildings.get(buildingId);
    if (!b || !b.underConstruction) return;
    for (const id of this.selectedUnitIds) {
      const u = this.units.get(id);
      if (!u || u.type !== 'villager') continue;
      u.order = { kind: 'build', buildingId, phase: 'toBuild' };
      this.pathTo(u, b.pos);
    }
  }

  private computeFormation(n: number): [number, number][] {
    // Simple grid: 3-wide rows
    const out: [number, number][] = [];
    const cols = Math.min(3, n);
    const spacing = 2.0;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = (col - (cols - 1) / 2) * spacing;
      const z = row * spacing;
      out.push([x, z]);
    }
    return out;
  }

  private pathTo(u: Unit, target: THREE.Vector3) {
    const tilePath = this.pathfinder.findPath(u.pos.x, u.pos.z, target.x, target.z);
    if (!tilePath) {
      u.path = [];
      u.pathTarget = target.clone();
      return;
    }
    const worldPath = this.pathfinder.pathToWorld(tilePath);
    // Drop the first waypoint if it's the unit's current tile
    u.path = worldPath.map(([x, z]) => {
      const y = this.terrain.getHeightAt(x, z);
      return new THREE.Vector3(x, y, z);
    });
    u.pathTarget = target.clone();
    // Add the exact target as the last waypoint
    if (u.path.length > 0) {
      const last = u.path[u.path.length - 1];
      if (last.distanceTo(target) > 1.5) {
        u.path.push(new THREE.Vector3(target.x, this.terrain.getHeightAt(target.x, target.z), target.z));
      }
    } else {
      u.path.push(new THREE.Vector3(target.x, this.terrain.getHeightAt(target.x, target.z), target.z));
    }
  }

  private spawnMoveMarker(pos: THREE.Vector3, color: number) {
    const geo = new THREE.RingGeometry(0.8, 1.2, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x, this.terrain.getHeightAt(pos.x, pos.z) + 0.1, pos.z);
    m.renderOrder = 998;
    this.scene.add(m);
    this.moveMarkers.push({ mesh: m, life: 0.8 });
  }

  // --------------------------------------------------------------------------
  // BUILDING PLACEMENT
  // --------------------------------------------------------------------------
  startBuildingPlacement(type: BuildingType) {
    const stats = BUILDING_STATS[type];
    const player = this.players.player;
    const r = player.resources;
    if ((stats.cost.wood || 0) > r.wood || (stats.cost.food || 0) > r.food || (stats.cost.gold || 0) > r.gold) {
      this.cb.onLog?.(`Not enough resources for ${stats.label}.`);
      return;
    }
    if (player.age < stats.age) {
      const ageIdx = AGE_ORDER.indexOf(player.age);
      const reqIdx = AGE_ORDER.indexOf(stats.age);
      if (reqIdx > ageIdx) {
        this.cb.onLog?.(`${stats.label} requires ${AGE_INFO[stats.age].label}.`);
        return;
      }
    }
    // Clean up any existing ghost from a previous placement attempt
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      this.ghostMesh.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mat = o.material as THREE.Material;
          if (mat.dispose) mat.dispose();
        }
      });
      this.ghostMesh = null;
    }
    this.placingBuilding = type;
    // Create ghost mesh
    this.ghostMesh = buildBuildingMesh(type, 'player');
    this.ghostMesh.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const oldMat = o.material as THREE.Material;
        const newMat = new THREE.MeshBasicMaterial({
          color: 0x33ff66, transparent: true, opacity: 0.7, wireframe: false,
          depthTest: true,
        });
        o.material = newMat;
        // Discard old mat
        if (oldMat.dispose) oldMat.dispose();
      }
    });
    this.ghostMesh.visible = false;
    this.scene.add(this.ghostMesh);
    this.cb.onBuildingPlace?.(true, type);
  }

  cancelBuildingPlacement() {
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      this.ghostMesh = null;
    }
    this.placingBuilding = null;
    this.cb.onBuildingPlace?.(false, null);
  }

  private canPlaceBuildingAt(type: BuildingType, pos: THREE.Vector3): boolean {
    const stats = BUILDING_STATS[type];
    const [w, d] = stats.footprint;
    const halfW = w * TILE / 2;
    const halfD = d * TILE / 2;
    // Check all tiles under footprint
    for (let dx = -halfW - TILE; dx <= halfW + TILE; dx += TILE) {
      for (let dz = -halfD - TILE; dz <= halfD + TILE; dz += TILE) {
        const x = pos.x + dx;
        const z = pos.z + dz;
        if (this.terrain.isWaterAt(x, z)) return false;
        // Check slope
        const hx1 = this.terrain.getHeightAt(x + 1, z);
        const hx2 = this.terrain.getHeightAt(x - 1, z);
        const hz1 = this.terrain.getHeightAt(x, z + 1);
        const hz2 = this.terrain.getHeightAt(x, z - 1);
        const slope = Math.hypot(hx1 - hx2, hz1 - hz2) / 2;
        if (slope > 1.2) return false;
        // Check pathfinder blocked
        const [tx, tz] = this.pathfinder.worldToTile(x, z);
        if (this.pathfinder.isBlocked(tx, tz)) return false;
      }
    }
    // Check distance from existing friendly buildings (must be in influence)
    let hasNearbyFriendly = false;
    for (const b of this.buildings.values()) {
      if (b.team !== 'player') continue;
      if (b.pos.distanceTo(pos) < 45) {
        hasNearbyFriendly = true;
        break;
      }
    }
    if (!hasNearbyFriendly && type !== 'wall') return false;
    return true;
  }

  private placeBuilding(type: BuildingType, pos: THREE.Vector3) {
    const stats = BUILDING_STATS[type];
    const player = this.players.player;
    const r = player.resources;
    r.wood -= stats.cost.wood || 0;
    r.food -= stats.cost.food || 0;
    r.gold -= stats.cost.gold || 0;
    const y = this.terrain.getHeightAt(pos.x, pos.z);
    const finalPos = new THREE.Vector3(pos.x, y, pos.z);
    const b = this.createBuilding(type, 'player', finalPos, true);
    this.blockBuildingFootprint(b);
    // Auto-assign idle villagers to build
    const idleVillagers = [...this.units.values()].filter(
      u => u.team === 'player' && u.alive && u.type === 'villager' &&
           (u.order.kind === 'idle' || u.order.kind === 'gather' && u.carrying === null)
    );
    for (const v of idleVillagers.slice(0, 2)) {
      v.order = { kind: 'build', buildingId: b.id, phase: 'toBuild' };
      this.pathTo(v, b.pos);
    }
    // Cleanup ghost
    this.scene.remove(this.ghostMesh!);
    this.ghostMesh = null;
    this.placingBuilding = null;
    this.cb.onBuildingPlace?.(false, null);
    this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
  }

  // --------------------------------------------------------------------------
  // PRODUCTION QUEUE (from selected building)
  // --------------------------------------------------------------------------
  trainFromSelected(unitType: UnitType) {
    if (this.selectedBuildingId === null) return;
    const b = this.buildings.get(this.selectedBuildingId);
    if (!b || b.team !== 'player' || b.underConstruction) return;
    const stats = BUILDING_STATS[b.type];
    if (!stats.produces?.includes(unitType)) return;
    const unitStats = UNIT_STATS[unitType];
    // Check age requirement
    if (playerAgeIdx(this.players.player) < AGE_ORDER.indexOf(unitStats.age)) {
      this.cb.onLog?.(`${unitStats.label} requires ${AGE_INFO[unitStats.age].label}.`);
      return;
    }
    // Check pop cap
    if (this.players.player.pop + unitStats.popCost > this.players.player.popCap) {
      this.cb.onLog?.('Population cap reached. Build more houses.');
      return;
    }
    // Check resources
    const r = this.players.player.resources;
    if ((unitStats.cost.wood || 0) > r.wood || (unitStats.cost.food || 0) > r.food || (unitStats.cost.gold || 0) > r.gold) {
      this.cb.onLog?.(`Not enough resources for ${unitStats.label}.`);
      return;
    }
    // Spend
    r.wood -= unitStats.cost.wood || 0;
    r.food -= unitStats.cost.food || 0;
    r.gold -= unitStats.cost.gold || 0;
    // Enqueue
    b.queue.push({ unit: unitType, progress: 0, cost: unitStats.cost });
    this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
  }

  cancelTrainFromSelected(slot: number) {
    if (this.selectedBuildingId === null) return;
    const b = this.buildings.get(this.selectedBuildingId);
    if (!b) return;
    const item = b.queue[slot];
    if (!item) return;
    this.refundForUnit(b.team, item.unit);
    b.queue.splice(slot, 1);
    this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
  }

  // --------------------------------------------------------------------------
  // AGE ADVANCEMENT
  // --------------------------------------------------------------------------
  advanceAge() {
    const player = this.players.player;
    if (player.advancing) return;
    const idx = AGE_ORDER.indexOf(player.age);
    if (idx >= AGE_ORDER.length - 1) return;
    const nextAge = AGE_ORDER[idx + 1];
    const info = AGE_INFO[nextAge];
    const r = player.resources;
    if ((info.advanceCost.food || 0) > r.food || (info.advanceCost.gold || 0) > r.gold) {
      this.cb.onLog?.(`Not enough resources to advance to ${info.label}.`);
      return;
    }
    r.food -= info.advanceCost.food || 0;
    r.gold -= info.advanceCost.gold || 0;
    player.advancing = {
      from: player.age,
      to: nextAge,
      progress: 0,
      total: info.advanceTime,
    };
    this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
    this.cb.onLog?.(`Advancing to ${info.label}...`);
  }

  // --------------------------------------------------------------------------
  // MAIN LOOP
  // --------------------------------------------------------------------------
  start() {
    this.clock.start();
    this.renderer.setAnimationLoop(this.tick);
  }

  private tick = () => {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.gameOver) {
      this.updateUnits(dt);
      this.updateBuildings(dt);
      this.updateProjectiles(dt);
      this.updateAI(dt);
      this.updateAdvancement(dt);
      this.updateMoveMarkers(dt);
      this.updateHpBars();
    }
    this.cameraRig.tick(dt);
    // Render selection box overlay (drawn by React HUD via DOM, not here)
    this.renderer.render(this.scene, this.camera);
  };

  // --------------------------------------------------------------------------
  // UNIT UPDATE
  // --------------------------------------------------------------------------
  private updateUnits(dt: number) {
    for (const u of this.units.values()) {
      if (!u.alive) continue;
      u.attackCooldown = Math.max(0, u.attackCooldown - dt);
      const stats = UNIT_STATS[u.type];

      // Order processing
      switch (u.order.kind) {
        case 'idle': {
          // Look for nearby enemy to attack (defensive auto-attack)
          if (u.type !== 'villager' && u.attackCooldown === 0) {
            const enemy = this.findNearestEnemy(u, stats.attackRange * 1.5);
            if (enemy) {
              u.order = { kind: 'attack', targetId: enemy.id };
            }
          }
          break;
        }
        case 'move': {
          this.followPath(u, dt, stats.moveSpeed);
          if (u.path.length === 0) {
            u.order = { kind: 'idle' };
          }
          break;
        }
        case 'attackMove': {
          this.followPath(u, dt, stats.moveSpeed);
          // Engage any enemy in range while moving
          const enemy = this.findNearestEnemy(u, stats.attackRange * 2);
          if (enemy) {
            u.order = { kind: 'attack', targetId: enemy.id };
          } else if (u.path.length === 0) {
            u.order = { kind: 'idle' };
          }
          break;
        }
        case 'attack': {
          const target = this.getUnitOrBuilding(u.order.targetId);
          if (!target) {
            u.order = { kind: 'idle' };
            break;
          }
          const targetPos = target.pos;
          const dist = u.pos.distanceTo(targetPos);
          const range = stats.attackRange + (target.__kind === 'building' ? 2 : 0.6);
          if (dist > range) {
            // Move toward target (re-path occasionally)
            if (u.path.length === 0 || u.pathTarget!.distanceTo(targetPos) > 2) {
              this.pathTo(u, targetPos);
            }
            this.followPath(u, dt, stats.moveSpeed);
          } else {
            // In range — attack
            u.path = [];
            // Face target
            const dx = targetPos.x - u.pos.x;
            const dz = targetPos.z - u.pos.z;
            u.facing = Math.atan2(dx, dz);
            if (u.attackCooldown === 0) {
              this.performAttack(u, target);
              u.attackCooldown = stats.attackSpeed;
            }
          }
          break;
        }
        case 'gather': {
          this.updateGather(u, dt, stats);
          break;
        }
        case 'build': {
          this.updateBuild(u, dt, stats);
          break;
        }
        case 'returnResource': {
          const b = this.buildings.get(u.order.dropBuildingId);
          if (!b) {
            u.order = { kind: 'idle' };
            break;
          }
          const dist = u.pos.distanceTo(b.pos);
          if (dist > 4) {
            if (u.path.length === 0) this.pathTo(u, b.pos);
            this.followPath(u, dt, stats.moveSpeed);
          } else {
            // Deposit
            if (u.carrying) {
              this.players[u.team].resources[u.carrying.type] += u.carrying.amount;
              u.carrying = null;
              if (u.team === 'player') this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
            }
            u.order = { kind: 'idle' };
          }
          break;
        }
      }

      // Apply movement from velocity
      if (u.velocity.lengthSq() > 0) {
        u.pos.addScaledVector(u.velocity, dt);
        u.velocity.multiplyScalar(0); // velocity is per-frame delta, not persistent
        // Clamp to terrain
        const y = this.terrain.getHeightAt(u.pos.x, u.pos.z);
        u.pos.y = y;
        // Avoid stacking on water
        if (this.terrain.isWaterAt(u.pos.x, u.pos.z)) {
          // push back toward nearest walkable
          const [tx, tz] = this.pathfinder.worldToTile(u.pos.x, u.pos.z);
          const alt = this.pathfinder.findNearestWalkable(tx, tz, 3);
          if (alt) {
            const [wx, wz] = this.pathfinder.tileToWorld(alt[0], alt[1]);
            u.pos.x = wx; u.pos.z = wz;
            u.pos.y = this.terrain.getHeightAt(u.pos.x, u.pos.z);
          }
        }
      }

      // Update mesh
      u.mesh.position.copy(u.pos);
      // Smooth rotate toward facing
      const cur = u.mesh.rotation.y;
      let diff = u.facing - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      u.mesh.rotation.y = cur + diff * Math.min(1, dt * 8);

      // --- Animation ---
      // Determine animation state
      const moving = u.velocity.lengthSq() > 0.001 || u.path.length > 0;
      const isAttacking = u.order.kind === 'attack' && u.attackCooldown > stats.attackSpeed * 0.7;
      const isGathering = u.order.kind === 'gather' && (u.order as any).phase === 'gathering';
      let newState: 'idle' | 'walk' | 'attack' | 'gather';
      if (isAttacking) newState = 'attack';
      else if (isGathering) newState = 'gather';
      else if (moving) newState = 'walk';
      else newState = 'idle';
      if (newState !== u.anim.state) {
        u.anim.state = newState;
        u.anim.phase = 0;
      }
      this.animateUnit(u, dt, stats);
    }
  }

  /**
   * Per-unit-type animation. Updates limb rotations based on anim.state.
   * Different unit types get different animation flavors:
   *  - villager: gentle sway, tool swings when gathering
   *  - infantry: march walk, overhead sword chop on attack
   *  - archer: bow draw on attack
   *  - cavalry: horse gallop (whole body bounce), lance thrust on attack
   *  - ram: rolling wheels
   */
  private animateUnit(u: Unit, dt: number, stats: UnitStats) {
    const a = u.anim;
    const p = a.parts;
    const stats2 = UNIT_STATS[u.type];
    const category = stats2.category;

    // Phase advance speed depends on state
    let phaseSpeed = 6;
    if (a.state === 'walk') phaseSpeed = 8 * (stats2.moveSpeed / 7);
    else if (a.state === 'attack') phaseSpeed = 6 / stats2.attackSpeed;
    else if (a.state === 'gather') phaseSpeed = 5;
    else phaseSpeed = 2; // idle

    a.phase += dt * phaseSpeed;

    if (u.type === 'ram') {
      // Ram: just bob up and down slowly, wheels don't rotate (cylinders)
      const bob = Math.sin(a.phase * 0.8) * 0.05;
      u.mesh.position.y = u.pos.y + Math.abs(bob);
      return;
    }

    if (category === 'cavalry') {
      // Cavalry: horse gallop — whole unit bounces, no leg animation (horse legs are static meshes)
      if (a.state === 'walk') {
        const gallop = Math.sin(a.phase * 1.5);
        u.mesh.position.y = u.pos.y + Math.abs(gallop) * 0.15;
        // Slight forward lean
        if (p.torso) p.torso.rotation.x = gallop * 0.05;
      } else if (a.state === 'attack') {
        // Lance thrust — quick forward jab
        const swing = Math.sin(a.phase);
        if (p.armR) p.armR.rotation.x = -swing * 0.8;
        u.mesh.position.y = u.pos.y + Math.abs(Math.sin(a.phase * 0.5)) * 0.05;
      } else {
        u.mesh.position.y = u.pos.y;
        if (p.torso) p.torso.rotation.x = 0;
      }
      return;
    }

    // Humanoid units (villager, infantry, archer)
    const swing = Math.sin(a.phase);
    const swing2 = Math.sin(a.phase + Math.PI);

    if (a.state === 'idle') {
      // Idle: gentle breathing sway, arms slightly out
      const breathe = Math.sin(a.phase * 0.5) * 0.03;
      if (p.legL) p.legL.rotation.x = 0;
      if (p.legR) p.legR.rotation.x = 0;
      if (p.armL) p.armL.rotation.x = breathe;
      if (p.armR) p.armR.rotation.x = -breathe;
      u.mesh.position.y = u.pos.y + breathe * 0.3;
    } else if (a.state === 'walk') {
      // Walk: legs swing opposite, arms swing opposite to legs
      const amp = 0.5;
      if (p.legL) p.legL.rotation.x = swing * amp;
      if (p.legR) p.legR.rotation.x = swing2 * amp;
      if (p.armL) p.armL.rotation.x = swing2 * amp * 0.7;
      if (p.armR) p.armR.rotation.x = swing * amp * 0.7;
      // Vertical bob — highest when legs are mid-stride
      u.mesh.position.y = u.pos.y + Math.abs(Math.sin(a.phase)) * 0.06;
    } else if (a.state === 'attack') {
      // Attack: different per category
      const atkPhase = a.phase;
      if (category === 'archer') {
        // Archer: draw bow back (left arm pulls back), release
        const draw = Math.sin(atkPhase * 0.5);
        if (p.armL) p.armL.rotation.x = -draw * 1.2;
        if (p.armR) p.armR.rotation.x = draw * 0.3;
        u.mesh.position.y = u.pos.y;
      } else {
        // Infantry: overhead sword chop
        // Wind up (phase 0..PI/2), swing down (PI/2..PI)
        const chop = Math.sin(atkPhase);
        if (p.armR) p.armR.rotation.x = -chop * 1.5;
        if (p.armL) p.armL.rotation.x = chop * 0.3;
        // Slight forward lunge
        u.mesh.position.y = u.pos.y + Math.abs(Math.sin(atkPhase * 0.5)) * 0.04;
      }
    } else if (a.state === 'gather') {
      // Gather: tool swings up and down (chopping wood / mining)
      const chop = Math.sin(a.phase * 1.5);
      if (p.armR) p.armR.rotation.x = -chop * 1.0;
      if (p.armL) p.armL.rotation.x = chop * 0.2;
      if (p.legL) p.legL.rotation.x = 0;
      if (p.legR) p.legR.rotation.x = 0;
      u.mesh.position.y = u.pos.y + Math.abs(Math.sin(a.phase * 0.75)) * 0.03;
    }
  }

  private followPath(u: Unit, dt: number, speed: number) {
    if (u.path.length === 0) {
      u.velocity.set(0, 0, 0);
      return;
    }
    const wp = u.path[0];
    const dx = wp.x - u.pos.x;
    const dz = wp.z - u.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      u.path.shift();
      if (u.path.length === 0) {
        u.velocity.set(0, 0, 0);
        return;
      }
    }
    const dirX = dx / (dist || 1);
    const dirZ = dz / (dist || 1);
    u.velocity.set(dirX * speed, 0, dirZ * speed);
    u.facing = Math.atan2(dirX, dirZ);

    // Simple separation from other nearby units (avoid stacking)
    for (const other of this.units.values()) {
      if (other.id === u.id || !other.alive) continue;
      const d = other.pos.distanceTo(u.pos);
      if (d < 1.2 && d > 0.01) {
        const pushX = (u.pos.x - other.pos.x) / d;
        const pushZ = (u.pos.z - other.pos.z) / d;
        u.velocity.x += pushX * speed * 0.5;
        u.velocity.z += pushZ * speed * 0.5;
      }
    }
  }

  private updateGather(u: Unit, dt: number, stats: UnitStats) {
    const order = u.order as Extract<Unit['order'], { kind: 'gather' }>;
    const r = this.resources.get(order.resourceId);
    if (!r || !r.alive) {
      // Find another nearby resource of same type
      const next = this.findNearestResource(u.pos, order.resourceType, 20);
      if (next) {
        order.resourceId = next.id;
        order.phase = 'toResource';
        this.pathTo(u, next.pos);
      } else {
        u.order = { kind: 'idle' };
      }
      return;
    }
    if (order.phase === 'toResource') {
      const dist = u.pos.distanceTo(r.pos);
      if (dist > 2.5) {
        if (u.path.length === 0 || u.pathTarget!.distanceTo(r.pos) > 3) this.pathTo(u, r.pos);
        this.followPath(u, dt, stats.moveSpeed);
      } else {
        order.phase = 'gathering';
        u.path = [];
      }
    } else if (order.phase === 'gathering') {
      // Face resource
      const dx = r.pos.x - u.pos.x;
      const dz = r.pos.z - u.pos.z;
      u.facing = Math.atan2(dx, dz);
      // Gather over time
      const rate = GATHER_RATES[order.resourceType];
      const carry = u.carrying ? u.carrying.amount : 0;
      const tick = rate * dt;
      const newCarry = Math.min(VILLAGER_CARRY, carry + tick);
      if (u.carrying) u.carrying.amount = newCarry;
      else u.carrying = { type: order.resourceType, amount: newCarry };
      // Deplete resource
      r.amount -= tick;
      if (r.amount <= 0) {
        r.alive = false;
        this.scene.remove(r.mesh);
        this.resources.delete(r.id);
        // Unblock pathing
        const [tx, tz] = this.pathfinder.worldToTile(r.pos.x, r.pos.z);
        this.pathfinder.setBlocked(tx, tz, false);
      }
      // If full, head to nearest drop-off
      if (newCarry >= VILLAGER_CARRY) {
        const drop = this.findNearestDropoff(u);
        if (drop) {
          order.phase = 'toDrop';
          this.pathTo(u, drop.pos);
        } else {
          // No dropoff — keep gathering (waste) but at least keep moving
          order.phase = 'gathering';
        }
      }
    } else if (order.phase === 'toDrop') {
      const drop = this.findNearestDropoff(u);
      if (!drop) {
        order.phase = 'gathering';
        return;
      }
      const dist = u.pos.distanceTo(drop.pos);
      if (dist > 4) {
        if (u.path.length === 0 || u.pathTarget!.distanceTo(drop.pos) > 3) this.pathTo(u, drop.pos);
        this.followPath(u, dt, stats.moveSpeed);
      } else {
        // Deposit
        if (u.carrying) {
          this.players[u.team].resources[u.carrying.type] += u.carrying.amount;
          u.carrying = null;
          if (u.team === 'player') this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
        }
        // Back to resource
        order.phase = 'toResource';
        this.pathTo(u, r.pos);
      }
    }
  }

  private updateBuild(u: Unit, dt: number, stats: UnitStats) {
    const order = u.order as Extract<Unit['order'], { kind: 'build' }>;
    const b = this.buildings.get(order.buildingId);
    if (!b) {
      u.order = { kind: 'idle' };
      return;
    }
    if (order.phase === 'toBuild') {
      const dist = u.pos.distanceTo(b.pos);
      if (dist > 4) {
        if (u.path.length === 0 || u.pathTarget!.distanceTo(b.pos) > 3) this.pathTo(u, b.pos);
        this.followPath(u, dt, stats.moveSpeed);
      } else {
        order.phase = 'building';
        u.path = [];
        b.builders.add(u.id);
      }
    } else if (order.phase === 'building') {
      // Face building
      const dx = b.pos.x - u.pos.x;
      const dz = b.pos.z - u.pos.z;
      u.facing = Math.atan2(dx, dz);
      if (b.buildProgress >= 1) {
        b.builders.delete(u.id);
        // Auto-return to gathering nearest resource
        const next = this.findNearestResource(u.pos, 'wood', 25) ||
                     this.findNearestResource(u.pos, 'food', 25);
        if (next) {
          u.order = {
            kind: 'gather', resourceId: next.id, phase: 'toResource', resourceType: next.type,
          };
          this.pathTo(u, next.pos);
        } else {
          u.order = { kind: 'idle' };
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // COMBAT
  // --------------------------------------------------------------------------
  private performAttack(u: Unit, target: Unit | Building) {
    const stats = UNIT_STATS[u.type];
    if (stats.projectile) {
      // Spawn projectile
      const from = u.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
      const to = target.pos.clone().add(new THREE.Vector3(0, target.__kind === 'building' ? 1.5 : 1.0, 0));
      this.spawnProjectile(from, to, stats.damage, u.team, target.id, target.__kind === 'building' ? false : true, u.type);
    } else {
      // Melee instant damage
      this.applyDamage(u, target, stats.damage);
    }
  }

  private applyDamage(attacker: Unit, target: Unit | Building, baseDamage: number) {
    const stats = UNIT_STATS[attacker.type];
    let dmg = baseDamage;
    // Bonus
    if (target.__kind === 'unit') {
      const tStats = UNIT_STATS[target.type];
      const bonus = stats.bonusVs?.[tStats.category];
      if (bonus) dmg *= bonus;
    } else {
      // Building bonus
      const bonus = stats.bonusVs?.building;
      if (bonus) dmg *= bonus;
    }
    dmg = Math.max(1, dmg - (target.__kind === 'unit' ? UNIT_STATS[target.type].armor : 0));
    target.hp -= dmg;
    if (target.hp <= 0) {
      this.killUnitOrBuilding(target);
    }
  }

  private spawnProjectile(
    from: THREE.Vector3, to: THREE.Vector3, damage: number, team: Team,
    targetId: number, targetUnit: boolean, unitType: UnitType,
  ) {
    const geo = new THREE.SphereGeometry(0.1, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.castShadow = false;
    this.scene.add(mesh);
    const id = this.nextId++;
    const dist = from.distanceTo(to);
    this.projectiles.push({
      id, mesh, from: from.clone(), to: to.clone(),
      t: 0, speed: 30 + dist * 0.5, damage, team, targetId, targetUnit,
      arc: Math.min(2.5, dist * 0.15),
      fromPos: from.clone(), toPos: to.clone(),
    });
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const totalDist = p.fromPos.distanceTo(p.toPos);
      const step = (p.speed * dt) / Math.max(0.1, totalDist);
      p.t += step;
      if (p.t >= 1) {
        // Hit
        if (p.targetUnit) {
          const t = this.units.get(p.targetId);
          if (t && t.alive) {
            const attacker = [...this.units.values()].find(u => u.team === p.team);
            if (attacker) this.applyDamage(attacker, t, p.damage);
            else t.hp -= p.damage;
            if (t.hp <= 0) this.killUnitOrBuilding(t);
          }
        } else {
          const t = this.buildings.get(p.targetId);
          if (t) {
            t.hp -= p.damage;
            if (t.hp <= 0) this.killUnitOrBuilding(t);
          }
        }
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
        continue;
      }
      // Position along arc
      const x = p.fromPos.x + (p.toPos.x - p.fromPos.x) * p.t;
      const z = p.fromPos.z + (p.toPos.z - p.fromPos.z) * p.t;
      const y = p.fromPos.y + (p.toPos.y - p.fromPos.y) * p.t + Math.sin(p.t * Math.PI) * p.arc;
      p.mesh.position.set(x, y, z);
    }
  }

  private killUnitOrBuilding(target: Unit | Building) {
    if (target.__kind === 'unit') {
      target.alive = false;
      target.hp = 0;
      this.scene.remove(target.mesh);
      // Dispose
      target.mesh.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          // Don't dispose shared materials
        }
      });
      this.units.delete(target.id);
      // Update player pop
      this.players[target.team].pop -= UNIT_STATS[target.type].popCost;
      // Remove from any build sets
      for (const b of this.buildings.values()) {
        b.builders.delete(target.id);
      }
      // Remove from selection
      const idx = this.selectedUnitIds.indexOf(target.id);
      if (idx >= 0) {
        this.selectedUnitIds.splice(idx, 1);
        this.cb.onSelectionChange?.({ unitIds: this.selectedUnitIds, buildingId: null });
      }
      if (target.team === 'player') this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
    } else {
      // Building
      this.unblockBuildingFootprint(target);
      this.scene.remove(target.mesh);
      target.mesh.traverse(o => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      this.buildings.delete(target.id);
      this.updatePopCap(target.team);
      // Check game over
      if (target.type === 'town_center') {
        // Count TCs per team
        const playerTCs = [...this.buildings.values()].filter(b => b.team === 'player' && b.type === 'town_center').length;
        const enemyTCs = [...this.buildings.values()].filter(b => b.team === 'enemy' && b.type === 'town_center').length;
        if (playerTCs === 0) this.endGame('enemy');
        else if (enemyTCs === 0) this.endGame('player');
      }
      // Remove from selection
      if (this.selectedBuildingId === target.id) {
        this.selectedBuildingId = null;
        this.cb.onSelectionChange?.({ unitIds: [], buildingId: null });
      }
      if (target.team === 'player') this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
    }
  }

  private endGame(winner: Team) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.cb.onGameOver?.(winner);
  }

  // --------------------------------------------------------------------------
  // BUILDING UPDATE (production queue, defensive attacks)
  // --------------------------------------------------------------------------
  private updateBuildings(dt: number) {
    for (const b of this.buildings.values()) {
      // Construction progress
      if (b.underConstruction) {
        const buildersCount = b.builders.size;
        if (buildersCount > 0) {
          const buildRate = buildersCount * 0.15; // progress per sec per builder
          b.buildProgress = Math.min(1, b.buildProgress + buildRate * dt);
          b.hp = Math.min(b.maxHp, b.maxHp * (0.1 + 0.9 * b.buildProgress));
          if (b.buildProgress >= 1) {
            b.underConstruction = false;
            b.hp = b.maxHp;
            const scaffold = b.mesh.getObjectByName('scaffold');
            if (scaffold) scaffold.visible = false;
            b.mesh.children.forEach(c => {
              if (c.name === 'scaffold' || c.name === 'selectionRing' || c.name === 'hpBar') return;
              c.visible = true;
            });
            this.updatePopCap(b.team);
            if (b.team === 'player') {
              this.cb.onLog?.(`${BUILDING_STATS[b.type].label} complete.`);
            }
          }
        }
        continue;
      }
      // Production queue
      if (b.queue.length > 0) {
        const item = b.queue[0];
        const stats = UNIT_STATS[item.unit];
        item.progress += dt / stats.buildTime;
        if (item.progress >= 1) {
          // Spawn unit near building
          const spawnOffset = new THREE.Vector3(
            (BUILDING_STATS[b.type].footprint[0] / 2 + 1.5) * TILE,
            0,
            0,
          );
          // Apply building rotation? Buildings don't rotate, spawn in front (+Z)
          const angle = b.mesh.rotation.y;
          const sx = b.pos.x + Math.sin(angle) * 0 + 0;
          const sz = b.pos.z + (BUILDING_STATS[b.type].footprint[1] / 2 + 1.5) * TILE;
          const sy = this.terrain.getHeightAt(sx, sz);
          const unit = this.createUnit(item.unit, b.team, new THREE.Vector3(sx, sy, sz));
          if (unit && b.rallyPoint) {
            unit.order = { kind: 'move', target: b.rallyPoint.clone() };
            this.pathTo(unit, b.rallyPoint);
          }
          b.queue.shift();
          // Update selection panel if this building is selected
          if (this.selectedBuildingId === b.id) {
            this.cb.onSelectionChange?.({ unitIds: [], buildingId: b.id });
          }
        }
      }
      // Defensive attack (TC, tower)
      const stats = BUILDING_STATS[b.type];
      if (stats.attack) {
        b.attackCooldown = Math.max(0, b.attackCooldown - dt);
        if (b.attackCooldown === 0) {
          const enemy = this.findNearestEnemyOfBuilding(b, stats.attack.range);
          if (enemy) {
            // Spawn projectile from building top
            const from = b.pos.clone().add(new THREE.Vector3(0, 3, 0));
            const to = enemy.pos.clone().add(new THREE.Vector3(0, 1, 0));
            this.spawnProjectile(from, to, stats.attack.damage, b.team, enemy.id, enemy.__kind === 'unit', 'archer');
            b.attackCooldown = stats.attack.speed;
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // AI
  // --------------------------------------------------------------------------
  private updateAI(dt: number) {
    const ai = this.aiState;
    const enemy = this.players.enemy;
    // AI economy: always try to keep villagers gathering, train more villagers
    ai.nextBuildTimer -= dt;
    if (ai.nextBuildTimer <= 0) {
      ai.nextBuildTimer = 8;
      this.aiEconomyTick();
    }
    // Wave timer
    ai.nextWaveTimer -= dt;
    if (ai.nextWaveTimer <= 0) {
      ai.nextWaveTimer = 75; // waves every 75s
      this.aiLaunchWave();
    }
    // Age advancement
    if (!enemy.advancing) {
      const idx = AGE_ORDER.indexOf(enemy.age);
      if (idx < AGE_ORDER.length - 1) {
        const nextAge = AGE_ORDER[idx + 1];
        const info = AGE_INFO[nextAge];
        const r = enemy.resources;
        if ((info.advanceCost.food || 0) <= r.food && (info.advanceCost.gold || 0) <= r.gold) {
          r.food -= info.advanceCost.food || 0;
          r.gold -= info.advanceCost.gold || 0;
          enemy.advancing = {
            from: enemy.age, to: nextAge, progress: 0, total: info.advanceTime,
          };
        }
      }
    }
    // Assign idle enemy villagers to gather
    for (const u of this.units.values()) {
      if (u.team !== 'enemy' || u.type !== 'villager' || !u.alive) continue;
      if (u.order.kind === 'idle') {
        const res = this.findNearestResource(u.pos, 'wood', 60) ||
                    this.findNearestResource(u.pos, 'food', 60) ||
                    this.findNearestResource(u.pos, 'gold', 60);
        if (res) {
          u.order = { kind: 'gather', resourceId: res.id, phase: 'toResource', resourceType: res.type };
          this.pathTo(u, res.pos);
        }
      }
    }
  }

  private aiEconomyTick() {
    const enemy = this.players.enemy;
    const r = enemy.resources;
    // Train villagers if pop allows
    const enemyTCs = [...this.buildings.values()].filter(b => b.team === 'enemy' && b.type === 'town_center' && !b.underConstruction);
    const villagerCount = [...this.units.values()].filter(u => u.team === 'enemy' && u.type === 'villager').length;
    if (villagerCount < 20 && enemyTCs.length > 0) {
      const tc = enemyTCs[0];
      const cost = UNIT_STATS.villager.cost;
      if ((cost.food || 0) <= r.food && enemy.pop + 1 <= enemy.popCap) {
        r.food -= cost.food || 0;
        tc.queue.push({ unit: 'villager', progress: 0, cost: UNIT_STATS.villager.cost });
      }
    }
    // Build houses when pop close to cap
    if (enemy.popCap - enemy.pop < 4 && enemy.popCap < HARD_POP_CAP) {
      this.aiBuildBuilding('house');
    }
    // Build military buildings based on age
    const hasBarracks = [...this.buildings.values()].some(b => b.team === 'enemy' && b.type === 'barracks');
    if (!hasBarracks) this.aiBuildBuilding('barracks');
    if (enemy.age !== 'dark') {
      const hasArchery = [...this.buildings.values()].some(b => b.team === 'enemy' && b.type === 'archery_range');
      const hasStable = [...this.buildings.values()].some(b => b.team === 'enemy' && b.type === 'stable');
      if (!hasArchery) this.aiBuildBuilding('archery_range');
      if (!hasStable) this.aiBuildBuilding('stable');
    }
    if (enemy.age === 'castle' || enemy.age === 'imperial') {
      const hasSiege = [...this.buildings.values()].some(b => b.team === 'enemy' && b.type === 'siege_workshop');
      if (!hasSiege) this.aiBuildBuilding('siege_workshop');
    }
    // Train military
    this.aiTrainMilitary();
  }

  private aiBuildBuilding(type: BuildingType) {
    const enemy = this.players.enemy;
    const r = enemy.resources;
    const stats = BUILDING_STATS[type];
    if ((stats.cost.wood || 0) > r.wood) return;
    if (AGE_ORDER.indexOf(enemy.age) < AGE_ORDER.indexOf(stats.age)) return;
    // Find a free spot near an enemy TC
    const tc = [...this.buildings.values()].find(b => b.team === 'enemy' && b.type === 'town_center');
    if (!tc) return;
    // Try positions in a spiral around TC
    for (let radius = 6; radius < 30; radius += 2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const x = tc.pos.x + Math.cos(a) * radius;
        const z = tc.pos.z + Math.sin(a) * radius;
        const pos = new THREE.Vector3(x, 0, z);
        if (this.canPlaceBuildingAt(type, pos)) {
          r.wood -= stats.cost.wood || 0;
          r.food -= stats.cost.food || 0;
          r.gold -= stats.cost.gold || 0;
          const y = this.terrain.getHeightAt(x, z);
          const b = this.createBuilding(type, 'enemy', new THREE.Vector3(x, y, z), true);
          this.blockBuildingFootprint(b);
          // Auto-build: assign 2 villagers
          const villagers = [...this.units.values()].filter(
            u => u.team === 'enemy' && u.type === 'villager' && u.alive &&
                 (u.order.kind === 'idle' || u.order.kind === 'gather' && u.carrying === null)
          );
          for (const v of villagers.slice(0, 2)) {
            v.order = { kind: 'build', buildingId: b.id, phase: 'toBuild' };
            this.pathTo(v, b.pos);
          }
          return;
        }
      }
    }
  }

  private aiTrainMilitary() {
    const enemy = this.players.enemy;
    const r = enemy.resources;
    const militaryBuildings = [...this.buildings.values()].filter(
      b => b.team === 'enemy' && !b.underConstruction && BUILDING_STATS[b.type].produces
    );
    for (const b of militaryBuildings) {
      if (b.queue.length >= 2) continue;
      const produces = BUILDING_STATS[b.type].produces!;
      // Pick a unit type the AI can afford and is unlocked for current age
      const candidates = produces.filter(t => AGE_ORDER.indexOf(UNIT_STATS[t].age) <= AGE_ORDER.indexOf(enemy.age));
      // Prefer higher-tier units
      candidates.sort((a, b) => AGE_ORDER.indexOf(UNIT_STATS[b].age) - AGE_ORDER.indexOf(UNIT_STATS[a].age));
      for (const t of candidates) {
        const cost = UNIT_STATS[t].cost;
        if ((cost.wood || 0) <= r.wood && (cost.food || 0) <= r.food && (cost.gold || 0) <= r.gold &&
            enemy.pop + UNIT_STATS[t].popCost <= enemy.popCap) {
          r.wood -= cost.wood || 0;
          r.food -= cost.food || 0;
          r.gold -= cost.gold || 0;
          b.queue.push({ unit: t, progress: 0, cost: UNIT_STATS[t].cost });
          break;
        }
      }
    }
  }

  private aiLaunchWave() {
    const enemy = this.players.enemy;
    // Gather all idle enemy military units
    const army = [...this.units.values()].filter(
      u => u.team === 'enemy' && u.alive && u.type !== 'villager'
    );
    if (army.length < 3) return; // not enough yet
    // Target: nearest player building
    const playerBuildings = [...this.buildings.values()].filter(b => b.team === 'player');
    if (playerBuildings.length === 0) return;
    // Prefer TC, then towers, then military buildings
    const tc = playerBuildings.find(b => b.type === 'town_center');
    const target = tc || playerBuildings[0];
    for (const u of army) {
      u.order = { kind: 'attackMove', target: target.pos.clone() };
      this.pathTo(u, target.pos);
    }
    this.cb.onLog?.('Enemy army is attacking!');
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------
  private findNearestEnemy(u: Unit, range: number): Unit | Building | null {
    let best: Unit | Building | null = null;
    let bestDist = range;
    for (const other of this.units.values()) {
      if (other.team === u.team || !other.alive) continue;
      const d = other.pos.distanceTo(u.pos);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    for (const b of this.buildings.values()) {
      if (b.team === u.team) continue;
      const d = b.pos.distanceTo(u.pos);
      if (d < bestDist + 5) {
        // Prefer units slightly; if no unit found, building is valid
        if (!best || d < bestDist) {
          bestDist = d;
          best = b;
        }
      }
    }
    return best;
  }

  private findNearestEnemyOfBuilding(b: Building, range: number): Unit | null {
    let best: Unit | null = null;
    let bestDist = range;
    for (const u of this.units.values()) {
      if (u.team === b.team || !u.alive) continue;
      const d = u.pos.distanceTo(b.pos);
      if (d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
    return best;
  }

  private findNearestResource(pos: THREE.Vector3, type: ResourceType, maxDist: number): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestDist = maxDist;
    for (const r of this.resources.values()) {
      if (!r.alive || r.type !== type) continue;
      const d = r.pos.distanceTo(pos);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    return best;
  }

  private findNearestDropoff(u: Unit): Building | null {
    let best: Building | null = null;
    let bestDist = Infinity;
    for (const b of this.buildings.values()) {
      if (b.team !== u.team || b.underConstruction) continue;
      if (b.type === 'town_center' || b.type === 'storage') {
        const d = b.pos.distanceTo(u.pos);
        if (d < bestDist) {
          bestDist = d;
          best = b;
        }
      }
    }
    return best;
  }

  private getUnitOrBuilding(id: number): Unit | Building | null {
    return this.units.get(id) || this.buildings.get(id) || null;
  }

  private updateAdvancement(dt: number) {
    for (const team of ['player', 'enemy'] as Team[]) {
      const player = this.players[team];
      if (!player.advancing) continue;
      player.advancing.progress += dt;
      if (player.advancing.progress >= player.advancing.total) {
        player.age = player.advancing.to;
        player.advancing = null;
        if (team === 'player') {
          this.cb.onLog?.(`Advanced to ${AGE_INFO[player.age].label}!`);
          this.cb.onResourcesChange?.(this.players.player, this.players.enemy);
        }
      }
    }
  }

  private updateMoveMarkers(dt: number) {
    for (let i = this.moveMarkers.length - 1; i >= 0; i--) {
      const m = this.moveMarkers[i];
      m.life -= dt;
      const mat = m.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, m.life / 0.8) * 0.9;
      m.mesh.scale.setScalar(1 + (1 - m.life / 0.8) * 0.5);
      if (m.life <= 0) {
        this.scene.remove(m.mesh);
        m.mesh.geometry.dispose();
        (m.mesh.material as THREE.Material).dispose();
        this.moveMarkers.splice(i, 1);
      }
    }
  }

  private updateHpBars() {
    // Face HP bars toward camera
    const camPos = this.camera.position;
    for (const u of this.units.values()) {
      if (!u.alive) continue;
      const hpBar = u.mesh.getObjectByName('hpBar') as THREE.Group;
      if (!hpBar) continue;
      // Show only if selected or damaged
      const visible = this.selectedUnitIds.includes(u.id) || u.hp < u.maxHp;
      hpBar.visible = visible;
      if (visible) {
        hpBar.lookAt(camPos);
        const fg = hpBar.getObjectByName('hpBarFg') as THREE.Mesh;
        if (fg) {
          const ratio = Math.max(0, u.hp / u.maxHp);
          fg.scale.x = ratio;
          (fg.material as THREE.MeshBasicMaterial).color.setHex(
            u.team === 'player' ? (ratio > 0.5 ? 0x33ff66 : ratio > 0.25 ? 0xffaa33 : 0xff3333) : 0xff3333
          );
        }
      }
    }
    for (const b of this.buildings.values()) {
      const hpBar = b.mesh.getObjectByName('hpBar') as THREE.Group;
      if (!hpBar) continue;
      const visible = this.selectedBuildingId === b.id || b.hp < b.maxHp;
      hpBar.visible = visible;
      if (visible) {
        hpBar.lookAt(camPos);
        const fg = hpBar.getObjectByName('hpBarFg') as THREE.Mesh;
        if (fg) {
          const ratio = Math.max(0, b.hp / b.maxHp);
          fg.scale.x = ratio;
          (fg.material as THREE.MeshBasicMaterial).color.setHex(
            b.team === 'player' ? (ratio > 0.5 ? 0x33ff66 : ratio > 0.25 ? 0xffaa33 : 0xff3333) : 0xff3333
          );
        }
      }
      // Building name label: always visible on mobile, hidden on desktop
      // (desktop uses hover tooltip instead)
      if (b.label) {
        b.label.visible = this.isMobile && !b.underConstruction;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Drag box visual (called by React layer via getDragBox)
  // --------------------------------------------------------------------------
  getDragBox() { return this.dragBox || this.touchDragBox; }

  // --------------------------------------------------------------------------
  // Resize
  // --------------------------------------------------------------------------
  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.cameraRig.detach();
    window.removeEventListener('resize', this.onResize);
    const el = this.renderer.domElement;
    el.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    el.removeEventListener('mousemove', this.onMouseMove);
    el.removeEventListener('contextmenu', this.onContext);
    if (el.parentElement) el.parentElement.removeChild(el);
    disposeIcons();
  }

  // --------------------------------------------------------------------------
  // Public accessors for HUD
  // --------------------------------------------------------------------------
  getPlayer() { return this.players.player; }
  getEnemy() { return this.players.enemy; }
  getSelectedUnits() { return this.selectedUnitIds.map(id => this.units.get(id)).filter(Boolean) as Unit[]; }
  getSelectedBuilding() { return this.selectedBuildingId !== null ? this.buildings.get(this.selectedBuildingId) : null; }
  isGameOver() { return this.gameOver; }

  // For minimap rendering
  getMinimapData() {
    return {
      units: [...this.units.values()].filter(u => u.alive).map(u => ({
        x: u.pos.x, z: u.pos.z, team: u.team, type: u.type,
      })),
      buildings: [...this.buildings.values()].map(b => ({
        x: b.pos.x, z: b.pos.z, team: b.team, type: b.type,
      })),
      resources: [...this.resources.values()].filter(r => r.alive).map(r => ({
        x: r.pos.x, z: r.pos.z, type: r.type,
      })),
      cameraFocal: { x: this.cameraRig.focal.x, z: this.cameraRig.focal.z },
      cameraView: this.getCameraViewportCorners(),
    };
  }

  private getCameraViewportCorners(): { x: number; z: number }[] {
    // Project the 4 corners of the NDC cube back onto the terrain plane
    const corners: { x: number; z: number }[] = [];
    const pts = [
      new THREE.Vector2(-1, 1), new THREE.Vector2(1, 1),
      new THREE.Vector2(1, -1), new THREE.Vector2(-1, -1),
    ];
    for (const p of pts) {
      this.raycaster.setFromCamera(p, this.camera);
      const hit = this.raycaster.intersectObject(this.terrain.mesh, false)[0];
      if (hit) corners.push({ x: hit.point.x, z: hit.point.z });
      else {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const out = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(plane, out)) corners.push({ x: out.x, z: out.z });
      }
    }
    return corners;
  }

  // Minimap click — pan camera
  panToMinimapPoint(x: number, z: number) {
    this.cameraRig.setFocal(x, z);
  }
}

// Helper
function playerAgeIdx(p: Player): number {
  return AGE_ORDER.indexOf(p.age);
}
