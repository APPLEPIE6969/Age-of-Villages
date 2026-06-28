// ============================================================================
// RTS Camera: orbit-around-focal-point on the terrain.
// WASD/arrows pan, scroll zoom, Q/E rotate, edge-pan, middle-drag rotate.
// Pitch is clamped to a RTS-friendly range. Distance zoom (not FOV).
// ============================================================================

import * as THREE from 'three';
import { MAP_SIZE } from './constants';

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  focal = new THREE.Vector3(0, 0, 0);
  yaw = 0;
  pitch = 0.95;   // radians (0 = horizon, PI/2 = top-down)
  distance = 50;
  minDist = 18;
  maxDist = 110;
  minPitch = 0.5;
  maxPitch = 1.35;
  panSpeed = 0.9;
  rotateSpeed = 0.005;
  zoomSpeed = 0.08;
  edgePanMargin = 24; // px
  edgePanActive = false;

  private keys: Record<string, boolean> = {};
  private mouse: { x: number; y: number; inside: boolean } = { x: 0, y: 0, inside: false };
  private dragging: 'none' | 'rotate' = 'none';
  private lastMouse: { x: number; y: number } = { x: 0, y: 0 };
  private getHeightAt: (x: number, z: number) => number;
  private dom: HTMLElement;
  private enabled = true;

  constructor(
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    getHeightAt: (x: number, z: number) => number,
  ) {
    this.camera = camera;
    this.dom = dom;
    this.getHeightAt = getHeightAt;
    this.camera.rotation.order = 'YXZ';
    this.update();
    this.attach();
  }

  setEnabled(v: boolean) { this.enabled = v; this.edgePanActive = false; }

  private attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.dom.addEventListener('mousemove', this.onMouseMove);
    this.dom.addEventListener('mouseenter', () => this.mouse.inside = true);
    this.dom.addEventListener('mouseleave', () => this.mouse.inside = false);
    this.dom.addEventListener('wheel', this.onWheel, { passive: false });
    this.dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.dom.addEventListener('contextmenu', this.onContext);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.dom.removeEventListener('mousemove', this.onMouseMove);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.dom.removeEventListener('contextmenu', this.onContext);
  }

  private onContext = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.key.toLowerCase()] = true;
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.key.toLowerCase()] = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (this.dragging === 'rotate') {
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.yaw -= dx * this.rotateSpeed;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + dy * this.rotateSpeed,
        this.minPitch,
        this.maxPitch,
      );
      this.update();
    }
    this.lastMouse.x = e.clientX;
    this.lastMouse.y = e.clientY;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 1) { // middle = rotate
      this.dragging = 'rotate';
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
    }
  };
  private onMouseUp = () => {
    this.dragging = 'none';
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    const delta = e.deltaY * this.zoomSpeed;
    this.distance = THREE.MathUtils.clamp(
      this.distance + delta * (this.distance / 50),
      this.minDist,
      this.maxDist,
    );
    this.update();
  };

  panByScreen(dx: number, dz: number) {
    // Pan in screen space relative to current yaw
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw), 0, -Math.cos(this.yaw)
    );
    const right = new THREE.Vector3(
      Math.cos(this.yaw), 0, -Math.sin(this.yaw)
    );
    this.focal.addScaledVector(right, dx);
    this.focal.addScaledVector(forward, dz);
    this.clampFocal();
    this.update();
  }

  private clampFocal() {
    const lim = MAP_SIZE / 2 - 5;
    this.focal.x = THREE.MathUtils.clamp(this.focal.x, -lim, lim);
    this.focal.z = THREE.MathUtils.clamp(this.focal.z, -lim, lim);
  }

  setFocal(x: number, z: number) {
    this.focal.set(x, 0, z);
    this.clampFocal();
    this.update();
  }

  rotateBy(dYaw: number) {
    this.yaw += dYaw;
    this.update();
  }

  update = () => {
    // Position camera in spherical coords around focal
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.focal.x + this.distance * Math.sin(this.yaw) * cp,
      this.focal.y + this.distance * Math.sin(this.pitch),
      this.focal.z + this.distance * Math.cos(this.yaw) * cp,
    );
    this.camera.lookAt(this.focal.x, this.getHeightAt(this.focal.x, this.focal.z) + 1, this.focal.z);
  };

  tick(dt: number) {
    if (!this.enabled) return;
    // Keyboard pan
    let dx = 0, dz = 0;
    if (this.keys['w'] || this.keys['arrowup']) dz -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) dz += 1;
    if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) dx += 1;
    if (this.keys['q']) this.yaw += this.rotateSpeed * 60 * dt;
    if (this.keys['e']) this.yaw -= this.rotateSpeed * 60 * dt;
    // Edge pan (when mouse inside the canvas region)
    if (this.mouse.inside) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (this.mouse.x < this.edgePanMargin) dx -= 1;
      else if (this.mouse.x > w - this.edgePanMargin) dx += 1;
      if (this.mouse.y < this.edgePanMargin) dz -= 1;
      else if (this.mouse.y > h - this.edgePanMargin) dz += 1;
    }
    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz) || 1;
      const speed = this.panSpeed * (this.distance / 30) * dt * 60;
      this.panByScreen((dx / len) * speed, (dz / len) * speed);
    } else {
      this.update();
    }
  }
}
