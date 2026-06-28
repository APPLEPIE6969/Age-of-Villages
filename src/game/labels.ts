// ============================================================================
// Text sprite helper: creates a THREE.Sprite with a canvas-rendered label.
// Used for building name labels above buildings.
// ============================================================================

import * as THREE from 'three';

const labelCache = new Map<string, THREE.Sprite>();

/**
 * Create (or fetch from cache) a text label sprite.
 * The sprite faces the camera always and has a transparent background.
 */
export function createLabelSprite(text: string, opts?: {
  fontSize?: number;
  color?: string;
  bgColor?: string;
  bgOpacity?: number;
  bold?: boolean;
}): THREE.Sprite {
  const key = `${text}_${opts?.fontSize ?? 32}_${opts?.color ?? '#ffffff'}_${opts?.bgColor ?? '#000000'}_${opts?.bgOpacity ?? 0.6}_${opts?.bold ?? true}`;
  if (labelCache.has(key)) {
    return labelCache.get(key)!.clone();
  }

  const fontSize = opts?.fontSize ?? 32;
  const color = opts?.color ?? '#ffffff';
  const bgColor = opts?.bgColor ?? '#000000';
  const bgOpacity = opts?.bgOpacity ?? 0.6;
  const bold = opts?.bold ?? true;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  // Measure text
  const font = `${bold ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize * 1.2;
  const padX = 12;
  const padY = 6;
  canvas.width = Math.ceil(textWidth + padX * 2);
  canvas.height = Math.ceil(textHeight + padY * 2);

  // Redraw with correct canvas size
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Background pill
  ctx.fillStyle = bgColor;
  ctx.globalAlpha = bgOpacity;
  const r = (canvas.height) / 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, r);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Text
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,  // always render on top
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  // Scale: keep aspect ratio. World units ~ 1 unit per ~40px
  const scale = 0.025;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.renderOrder = 1000;

  labelCache.set(key, sprite);
  return sprite.clone();
}

/**
 * Create a detailed hover tooltip sprite (multi-line, larger).
 */
export function createTooltipSprite(lines: string[], opts?: {
  fontSize?: number;
  color?: string;
  bgColor?: string;
  bgOpacity?: number;
}): THREE.Sprite {
  const fontSize = opts?.fontSize ?? 24;
  const color = opts?.color ?? '#ffffff';
  const bgColor = opts?.bgColor ?? '#1a2530';
  const bgOpacity = opts?.bgOpacity ?? 0.92;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.font = font;

  // Measure all lines
  const lineHeight = fontSize * 1.35;
  const padX = 16;
  const padY = 12;
  let maxW = 0;
  for (const line of lines) {
    const m = ctx.measureText(line);
    if (m.width > maxW) maxW = m.width;
  }
  canvas.width = Math.ceil(maxW + padX * 2);
  canvas.height = Math.ceil(lineHeight * lines.length + padY * 2);

  // Redraw
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Background
  ctx.fillStyle = bgColor;
  ctx.globalAlpha = bgOpacity;
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
  ctx.fill();
  // Border
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#4f8cff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 8);
  ctx.stroke();

  // Lines
  ctx.fillStyle = color;
  for (let i = 0; i < lines.length; i++) {
    // Color-code lines starting with common prefixes
    const line = lines[i];
    if (line.startsWith('Cost:')) ctx.fillStyle = '#f5e6a8';
    else if (line.startsWith('HP:')) ctx.fillStyle = '#88ff88';
    else if (line.startsWith('Requires:')) ctx.fillStyle = '#ffaa66';
    else ctx.fillStyle = '#ffffff';
    ctx.fillText(line, padX, padY + lineHeight / 2 + i * lineHeight);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const scale = 0.02;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.renderOrder = 1001;

  return sprite;
}
