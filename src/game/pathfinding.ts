// ============================================================================
// A* pathfinder on a tile grid (MAP_TILES x MAP_TILES).
// Each tile is walkable or blocked (by buildings/water/steep slope).
// Returns a list of waypoints in world coordinates.
// ============================================================================

import { MAP_TILES, TILE } from './constants';

// Binary min-heap of {f, idx}
class MinHeap {
  private arr: { f: number; idx: number }[] = [];
  size() { return this.arr.length; }
  push(f: number, idx: number) {
    const a = this.arr;
    a.push({ f, idx });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { f: number; idx: number } | undefined {
    const a = this.arr;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let best = i;
        if (l < n && a[l].f < a[best].f) best = l;
        if (r < n && a[r].f < a[best].f) best = r;
        if (best === i) break;
        [a[best], a[i]] = [a[i], a[best]];
        i = best;
      }
    }
    return top;
  }
}

export class Pathfinder {
  // blocked[tz * MAP_TILES + tx] = true if tile is impassable
  blocked: Uint8Array;
  // cost multiplier (1.0 default; higher for slow terrain like sand)
  cost: Float32Array;
  tiles = MAP_TILES;

  constructor() {
    this.blocked = new Uint8Array(this.tiles * this.tiles);
    this.cost = new Float32Array(this.tiles * this.tiles).fill(1.0);
  }

  setBlocked(tx: number, tz: number, v: boolean) {
    if (tx < 0 || tz < 0 || tx >= this.tiles || tz >= this.tiles) return;
    this.blocked[tz * this.tiles + tx] = v ? 1 : 0;
  }

  isBlocked(tx: number, tz: number): boolean {
    if (tx < 0 || tz < 0 || tx >= this.tiles || tz >= this.tiles) return true;
    return this.blocked[tz * this.tiles + tx] === 1;
  }

  // World -> tile
  worldToTile(x: number, z: number): [number, number] {
    const half = this.tiles * TILE / 2;
    const tx = Math.floor((x + half) / TILE);
    const tz = Math.floor((z + half) / TILE);
    return [tx, tz];
  }

  // Tile -> world (center)
  tileToWorld(tx: number, tz: number): [number, number] {
    const half = this.tiles * TILE / 2;
    return [tx * TILE - half + TILE / 2, tz * TILE - half + TILE / 2];
  }

  // A* search from start tile to goal tile, returns array of tile coords
  // (or null if no path). Octile distance heuristic; 4-directional for speed.
  findPath(startX: number, startZ: number, goalX: number, goalZ: number): [number, number][] | null {
    const T = this.tiles;
    const [stx, stz] = this.worldToTile(startX, startZ);
    const [gtx, gtz] = this.worldToTile(goalX, goalZ);
    if (this.isBlocked(gtx, gtz)) {
      // Find nearest walkable tile near goal
      const alt = this.findNearestWalkable(gtx, gtz, 6);
      if (!alt) return null;
      return this.findPathTile(stx, stz, alt[0], alt[1]);
    }
    return this.findPathTile(stx, stz, gtx, gtz);
  }

  private findPathTile(stx: number, stz: number, gtx: number, gtz: number): [number, number][] | null {
    const T = this.tiles;
    if (stx === gtx && stz === gtz) return [[stx, stz]];
    if (this.isBlocked(stx, stz)) {
      const alt = this.findNearestWalkable(stx, stz, 3);
      if (!alt) return null;
      stx = alt[0]; stz = alt[1];
    }
    const startIdx = stz * T + stx;
    const goalIdx = gtz * T + gtx;
    const cameFrom = new Int32Array(T * T).fill(-1);
    const gScore = new Float32Array(T * T).fill(Infinity);
    const closed = new Uint8Array(T * T);
    const open = new MinHeap();
    gScore[startIdx] = 0;
    // Octile heuristic (4-dir = Manhattan)
    const h = (tx: number, tz: number) => Math.abs(tx - gtx) + Math.abs(tz - gtz);
    open.push(h(stx, stz), startIdx);

    const neighbors = [
      [0, -1], [0, 1], [-1, 0], [1, 0],
    ];

    let iter = 0;
    const maxIter = 20000;
    while (open.size() > 0 && iter < maxIter) {
      iter++;
      const cur = open.pop()!;
      const cIdx = cur.idx;
      if (cIdx === goalIdx) {
        // reconstruct
        const path: [number, number][] = [];
        let i = cIdx;
        while (i !== -1) {
          path.push([i % T, Math.floor(i / T)]);
          i = cameFrom[i];
        }
        path.reverse();
        return this.simplify(path);
      }
      if (closed[cIdx]) continue;
      closed[cIdx] = 1;
      const cx = cIdx % T;
      const cz = Math.floor(cIdx / T);
      for (const [dx, dz] of neighbors) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= T || nz >= T) continue;
        const nIdx = nz * T + nx;
        if (closed[nIdx] || this.blocked[nIdx]) continue;
        const tentative = gScore[cIdx] + this.cost[nIdx] + 0.01;
        if (tentative < gScore[nIdx]) {
          gScore[nIdx] = tentative;
          cameFrom[nIdx] = cIdx;
          open.push(tentative + h(nx, nz), nIdx);
        }
      }
    }
    return null;
  }

  // Remove redundant collinear waypoints
  private simplify(path: [number, number][]): [number, number][] {
    if (path.length <= 2) return path;
    const out: [number, number][] = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      const [px, py] = path[i - 1];
      const [cx, cy] = path[i];
      const [nx, ny] = path[i + 1];
      const dx1 = cx - px, dy1 = cy - py;
      const dx2 = nx - cx, dy2 = ny - cy;
      if (dx1 !== dx2 || dy1 !== dy2) out.push(path[i]);
    }
    out.push(path[path.length - 1]);
    return out;
  }

  // Spiral outward from (tx,tz) to find nearest walkable tile within maxRadius
  findNearestWalkable(tx: number, tz: number, maxRadius: number): [number, number] | null {
    if (!this.isBlocked(tx, tz)) return [tx, tz];
    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = tx + dx;
          const nz = tz + dz;
          if (!this.isBlocked(nx, nz)) return [nx, nz];
        }
      }
    }
    return null;
  }

  // Convert tile path to world waypoint list
  pathToWorld(tilePath: [number, number][]): [number, number][] {
    return tilePath.map(([tx, tz]) => this.tileToWorld(tx, tz));
  }
}
