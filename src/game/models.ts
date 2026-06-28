// ============================================================================
// Procedural unit & building meshes.
// Strong, readable silhouettes + PBR materials + team-color banner/cloak tint.
// All meshes are anchored at y=0 (feet on terrain) and face +Z by default.
// ============================================================================

import * as THREE from 'three';
import { getTextures, TEAM_COLORS } from './textures';
import { BuildingType, UnitType } from './constants';

// --- Helpers ---------------------------------------------------------------
function standardMat(opts: {
  color?: number;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  roughness?: number;
  metalness?: number;
}): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = {
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? 1.0,
    metalness: opts.metalness ?? 0.0,
  };
  if (opts.map) params.map = opts.map;
  if (opts.normalMap) params.normalMap = opts.normalMap;
  if (opts.roughnessMap) params.roughnessMap = opts.roughnessMap;
  return new THREE.MeshStandardMaterial(params);
}

function teamMat(team: 'player' | 'enemy', opts: {
  roughness?: number;
  metalness?: number;
}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: team === 'player' ? TEAM_COLORS.player : TEAM_COLORS.enemy,
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0.0,
    emissive: team === 'player' ? 0x2a5ccc : 0xcc2a1a,
    emissiveIntensity: 0.6,
  });
}

const _cached: Record<string, THREE.BufferGeometry> = {};

function cylGeo(rTop: number, rBot: number, h: number, segs = 8): THREE.CylinderGeometry {
  const key = `cyl_${rTop}_${rBot}_${h}_${segs}`;
  if (!_cached[key]) _cached[key] = new THREE.CylinderGeometry(rTop, rBot, h, segs);
  return _cached[key] as THREE.CylinderGeometry;
}
function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `box_${w}_${h}_${d}`;
  if (!_cached[key]) _cached[key] = new THREE.BoxGeometry(w, h, d);
  return _cached[key] as THREE.BoxGeometry;
}
function coneGeo(r: number, h: number, segs = 8): THREE.ConeGeometry {
  const key = `cone_${r}_${h}_${segs}`;
  if (!_cached[key]) _cached[key] = new THREE.ConeGeometry(r, h, segs);
  return _cached[key] as THREE.ConeGeometry;
}
function sphGeo(r: number, segs = 8): THREE.SphereGeometry {
  const key = `sph_${r}_${segs}`;
  if (!_cached[key]) _cached[key] = new THREE.SphereGeometry(r, segs, Math.max(4, Math.floor(segs / 2)));
  return _cached[key] as THREE.SphereGeometry;
}

// ----------------------------------------------------------------------------
// UNIT BUILDERS
// Each returns a Group positioned with feet at y=0, facing +Z.
// ----------------------------------------------------------------------------
export function buildUnitMesh(type: UnitType, team: 'player' | 'enemy'): THREE.Group {
  const tex = getTextures();
  const g = new THREE.Group();

  const skinMat = standardMat({ color: 0xc8956b, roughness: 0.8 });
  const clothMat = standardMat({
    map: tex.cloth.map, normalMap: tex.cloth.normalMap,
    roughnessMap: tex.cloth.roughnessMap, roughness: 0.9,
  });
  const teamClothMat = teamMat(team, { roughness: 0.7 });
  const woodMat = standardMat({
    map: tex.wood.map, normalMap: tex.wood.normalMap,
    roughnessMap: tex.wood.roughnessMap, roughness: 0.85,
  });
  const metalMat = standardMat({
    map: tex.metal.map, normalMap: tex.metal.normalMap,
    roughnessMap: tex.metal.roughnessMap, roughness: 0.4, metalness: 0.85,
  });
  const darkMat = standardMat({ color: 0x2b2b2b, roughness: 0.6 });

  // Base body parts used by most units
  const makeBody = (scale = 1) => {
    // Legs — pivot at hip (top of leg) so they can swing
    // We do this by creating a pivot Group at the hip, adding the leg mesh offset downward
    const legLPivot = new THREE.Group();
    legLPivot.position.set(-0.13 * scale, 0.55 * scale, 0);
    const legL = new THREE.Mesh(cylGeo(0.12 * scale, 0.14 * scale, 0.55 * scale, 6), clothMat);
    legL.position.y = -0.275 * scale; // half leg height below pivot
    legLPivot.add(legL);
    legLPivot.name = 'legL';

    const legRPivot = new THREE.Group();
    legRPivot.position.set(0.13 * scale, 0.55 * scale, 0);
    const legR = new THREE.Mesh(cylGeo(0.12 * scale, 0.14 * scale, 0.55 * scale, 6), clothMat);
    legR.position.y = -0.275 * scale;
    legRPivot.add(legR);
    legRPivot.name = 'legR';

    // Torso
    const torso = new THREE.Mesh(cylGeo(0.30 * scale, 0.34 * scale, 0.55 * scale, 8), teamClothMat);
    torso.position.y = 0.83 * scale;
    // Head
    const head = new THREE.Mesh(sphGeo(0.18 * scale, 8), skinMat);
    head.position.y = 1.25 * scale;
    // Arms — pivot at shoulder (top of arm) so they can swing
    const armLPivot = new THREE.Group();
    armLPivot.position.set(-0.35 * scale, 1.05 * scale, 0);
    armLPivot.rotation.z = 0.2;
    const armL = new THREE.Mesh(cylGeo(0.09 * scale, 0.11 * scale, 0.5 * scale, 6), skinMat);
    armL.position.y = -0.25 * scale;
    armLPivot.add(armL);
    armLPivot.name = 'armL';

    const armRPivot = new THREE.Group();
    armRPivot.position.set(0.35 * scale, 1.05 * scale, 0);
    armRPivot.rotation.z = -0.2;
    const armR = new THREE.Mesh(cylGeo(0.09 * scale, 0.11 * scale, 0.5 * scale, 6), skinMat);
    armR.position.y = -0.25 * scale;
    armRPivot.add(armR);
    armRPivot.name = 'armR';

    [legL, legR, torso, head, armL, armR].forEach(m => {
      m.castShadow = true; m.receiveShadow = false;
    });
    const grp = new THREE.Group();
    grp.add(legLPivot, legRPivot, torso, head, armLPivot, armRPivot);
    return { grp, armL: armLPivot, armR: armRPivot, legL: legLPivot, legR: legRPivot, torso, head };
  };

  switch (type) {
    case 'villager': {
      const b = makeBody(1);
      // Tool: a wooden hoe/axe — attach to right hand (armR pivot)
      const tool = new THREE.Mesh(boxGeo(0.05, 0.7, 0.05), woodMat);
      tool.position.set(0, -0.35, 0.1);
      tool.rotation.z = -0.3;
      tool.castShadow = true;
      tool.name = 'tool';
      b.armR.add(tool);
      // Sack on back
      const sack = new THREE.Mesh(sphGeo(0.2, 6), clothMat);
      sack.position.set(0, 1.0, -0.25);
      sack.castShadow = true;
      g.add(b.grp, sack);
      break;
    }
    case 'militia':
    case 'man_at_arms':
    case 'long_swordsman':
    case 'two_handed_swordsman': {
      const scale = type === 'militia' ? 1.0 :
                    type === 'man_at_arms' ? 1.05 :
                    type === 'long_swordsman' ? 1.12 : 1.18;
      const b = makeBody(scale);
      // Helmet
      const helmet = new THREE.Mesh(
        type === 'militia' ? cylGeo(0.18 * scale, 0.18 * scale, 0.12 * scale, 8) :
        sphGeo(0.20 * scale, 8),
        metalMat
      );
      helmet.position.y = 1.32 * scale;
      helmet.castShadow = true;
      // Sword
      const bladeLen = type === 'two_handed_swordsman' ? 1.1 : 0.8;
      const blade = new THREE.Mesh(boxGeo(0.06, bladeLen, 0.18), metalMat);
      blade.position.set(0.45 * scale, 0.55 * scale, 0.15);
      blade.rotation.z = -0.5;
      blade.castShadow = true;
      // Guard
      const guard = new THREE.Mesh(boxGeo(0.18, 0.05, 0.06), darkMat);
      guard.position.set(0.45 * scale, 0.55 * scale + bladeLen * 0.5, 0.15);
      // Handle
      const handle = new THREE.Mesh(cylGeo(0.04, 0.04, 0.18, 6), darkMat);
      handle.position.set(0.5 * scale, 0.55 * scale + bladeLen * 0.5 + 0.1, 0.15);
      handle.rotation.z = Math.PI / 2;
      // Shield
      const shield = new THREE.Mesh(cylGeo(0.28 * scale, 0.28 * scale, 0.05, 8), woodMat);
      shield.rotation.x = Math.PI / 2;
      shield.rotation.y = Math.PI / 8;
      shield.position.set(-0.4 * scale, 0.85 * scale, 0.1);
      shield.scale.x = 1.0;
      shield.castShadow = true;
      // Shield team rim
      const rim = new THREE.Mesh(cylGeo(0.29 * scale, 0.29 * scale, 0.06, 8), teamClothMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.copy(shield.position);
      rim.position.y += 0;
      // Attach sword to right hand (armR pivot)
      // Group the blade+guard+handle so they move together as the weapon
      const swordGroup = new THREE.Group();
      swordGroup.name = 'tool';
      blade.position.set(0, -bladeLen * 0.5, 0.1);
      blade.rotation.z = 0;
      guard.position.set(0, 0, 0.1);
      handle.position.set(0.05, 0.1, 0.1);
      handle.rotation.z = Math.PI / 2;
      swordGroup.add(blade, guard, handle);
      swordGroup.position.set(0, -0.25, 0); // hand position relative to shoulder pivot
      swordGroup.rotation.z = -0.5; // angled grip
      b.armR.add(swordGroup);
      g.add(b.grp, helmet, shield, rim);
      break;
    }
    case 'archer':
    case 'crossbowman':
    case 'arbalester': {
      const b = makeBody(0.95);
      // Hood
      const hood = new THREE.Mesh(coneGeo(0.22, 0.32, 8), clothMat);
      hood.position.y = 1.32;
      hood.castShadow = true;
      // Bow — attach to left hand (armL pivot)
      const bow = new THREE.Mesh(
        new THREE.TorusGeometry(0.35, 0.025, 6, 12, Math.PI * 1.2),
        woodMat
      );
      bow.position.set(0, -0.3, 0.1);
      bow.rotation.z = -Math.PI / 2;
      bow.castShadow = true;
      bow.name = 'tool';
      b.armL.add(bow);
      // Quiver on back
      const quiver = new THREE.Mesh(cylGeo(0.08, 0.1, 0.35, 6), darkMat);
      quiver.position.set(-0.15, 1.0, -0.2);
      quiver.rotation.x = -0.3;
      quiver.castShadow = true;
      g.add(b.grp, hood, quiver);
      break;
    }
    case 'scout':
    case 'knight':
    case 'cavalier': {
      // Horse body
      const horse = new THREE.Mesh(boxGeo(0.6, 0.45, 1.2), standardMat({ color: 0x5a3a1e, roughness: 0.85 }));
      horse.position.y = 1.1;
      horse.castShadow = true;
      // Horse neck
      const neck = new THREE.Mesh(cylGeo(0.18, 0.22, 0.55, 6), standardMat({ color: 0x5a3a1e, roughness: 0.85 }));
      neck.position.set(0, 1.5, 0.55);
      neck.rotation.x = 0.5;
      neck.castShadow = true;
      // Horse head
      const hHead = new THREE.Mesh(boxGeo(0.25, 0.25, 0.4), standardMat({ color: 0x5a3a1e, roughness: 0.85 }));
      hHead.position.set(0, 1.7, 0.85);
      hHead.castShadow = true;
      // Legs (4)
      const legGeo = cylGeo(0.08, 0.08, 1.1, 5);
      const legPos: [number, number, number][] = [
        [-0.2, 0.55, 0.4], [0.2, 0.55, 0.4],
        [-0.2, 0.55, -0.4], [0.2, 0.55, -0.4],
      ];
      legPos.forEach(p => {
        const l = new THREE.Mesh(legGeo, standardMat({ color: 0x4a2e16, roughness: 0.85 }));
        l.position.set(...p);
        l.castShadow = true;
        g.add(l);
      });
      // Tail
      const tail = new THREE.Mesh(cylGeo(0.06, 0.12, 0.4, 5), standardMat({ color: 0x3a2410, roughness: 0.9 }));
      tail.position.set(0, 1.0, -0.65);
      tail.rotation.x = 0.6;
      tail.castShadow = true;
      // Rider
      const rider = new THREE.Group();
      const riderBody = new THREE.Mesh(cylGeo(0.28, 0.32, 0.55, 8), teamMat(team, { roughness: 0.5 }));
      riderBody.position.y = 1.95;
      riderBody.castShadow = true;
      const riderHead = new THREE.Mesh(sphGeo(0.18, 8), skinMat);
      riderHead.position.y = 2.35;
      riderHead.castShadow = true;
      const riderHelmet = type === 'scout'
        ? new THREE.Mesh(cylGeo(0.18, 0.18, 0.12, 8), metalMat)
        : new THREE.Mesh(coneGeo(0.2, 0.3, 8), metalMat);
      riderHelmet.position.y = 2.45;
      riderHelmet.castShadow = true;
      // Lance/sword
      const lance = new THREE.Mesh(boxGeo(0.04, 1.6, 0.04), woodMat);
      lance.position.set(0.4, 1.7, 0.2);
      lance.rotation.z = -0.2;
      lance.castShadow = true;
      const lanceTip = new THREE.Mesh(coneGeo(0.04, 0.18, 6), metalMat);
      lanceTip.position.set(0.4, 2.55, 0.2);
      lanceTip.rotation.x = -0.2;
      lanceTip.castShadow = true;
      rider.add(riderBody, riderHead, riderHelmet, lance, lanceTip);
      g.add(horse, neck, hHead, tail, rider);
      break;
    }
    case 'ram': {
      // Battering ram: covered cart with a log
      const cart = new THREE.Mesh(boxGeo(1.2, 0.6, 2.0), woodMat);
      cart.position.y = 1.1;
      cart.castShadow = true;
      // Roof (curved tent)
      const roof = new THREE.Mesh(coneGeo(0.7, 0.8, 6), teamClothMat);
      roof.rotation.x = Math.PI / 2;
      roof.position.y = 1.7;
      roof.scale.z = 1.5;
      roof.castShadow = true;
      // Ram log
      const log = new THREE.Mesh(cylGeo(0.18, 0.18, 2.4, 8), standardMat({ color: 0x4a2e16, roughness: 0.9 }));
      log.rotation.x = Math.PI / 2;
      log.position.y = 0.8;
      log.castShadow = true;
      // Ram head (metal cap)
      const ramHead = new THREE.Mesh(coneGeo(0.22, 0.4, 8), metalMat);
      ramHead.rotation.x = Math.PI / 2;
      ramHead.position.set(0, 0.8, 1.3);
      ramHead.castShadow = true;
      // Wheels
      const wheelGeo = cylGeo(0.4, 0.4, 0.15, 10);
      wheelGeo.rotateZ(Math.PI / 2);
      const w1 = new THREE.Mesh(wheelGeo, darkMat); w1.position.set(-0.6, 0.4, 0.7);
      const w2 = new THREE.Mesh(wheelGeo, darkMat); w2.position.set(0.6, 0.4, 0.7);
      const w3 = new THREE.Mesh(wheelGeo, darkMat); w3.position.set(-0.6, 0.4, -0.7);
      const w4 = new THREE.Mesh(wheelGeo, darkMat); w4.position.set(0.6, 0.4, -0.7);
      [w1, w2, w3, w4].forEach(w => w.castShadow = true);
      g.add(cart, roof, log, ramHead, w1, w2, w3, w4);
      break;
    }
  }

  // Selection ring (hidden by default — toggled on selection)
  const ringGeo = new THREE.RingGeometry(0.55, 0.7, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88, transparent: true, opacity: 0.0, side: THREE.DoubleSide,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.06;
  ring.renderOrder = 999;
  ring.name = 'selectionRing';
  g.add(ring);

  // HP bar (hidden by default)
  const hpBarBg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthTest: false })
  );
  hpBarBg.position.y = 2.1;
  hpBarBg.renderOrder = 998;
  hpBarBg.visible = false;
  hpBarBg.name = 'hpBarBg';
  const hpBarFg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x33ff66, transparent: true, opacity: 0.95, depthTest: false })
  );
  hpBarFg.position.set(-0.5, 2.1, 0.001);
  hpBarFg.renderOrder = 999;
  hpBarFg.visible = false;
  hpBarFg.name = 'hpBarFg';
  // Anchor hp bar fg to the left edge so it shrinks toward the left
  (hpBarFg.geometry as THREE.PlaneGeometry).translate(0.5, 0, 0);
  const hpGroup = new THREE.Group();
  hpGroup.name = 'hpBar';
  hpGroup.add(hpBarBg, hpBarFg);
  g.add(hpGroup);

  g.name = `unit_${type}_${team}`;
  g.userData.unitType = type;
  g.userData.team = team;
  return g;
}

// ----------------------------------------------------------------------------
// BUILDING BUILDERS
// ----------------------------------------------------------------------------
export function buildBuildingMesh(type: BuildingType, team: 'player' | 'enemy'): THREE.Group {
  const tex = getTextures();
  const g = new THREE.Group();

  const woodMat = standardMat({
    map: tex.wood.map, normalMap: tex.wood.normalMap,
    roughnessMap: tex.wood.roughnessMap, roughness: 0.85,
  });
  const stoneMat = standardMat({
    map: tex.stone.map, normalMap: tex.stone.normalMap,
    roughnessMap: tex.stone.roughnessMap, roughness: 0.9,
  });
  const metalMat = standardMat({
    map: tex.metal.map, normalMap: tex.metal.normalMap,
    roughnessMap: tex.metal.roughnessMap, roughness: 0.4, metalness: 0.7,
  });
  const teamClothMat = teamMat(team, { roughness: 0.7 });
  const thatchMat = standardMat({ color: 0x8a6e3b, roughness: 0.95 });

  switch (type) {
    case 'town_center': {
      // Stone first floor
      const base = new THREE.Mesh(boxGeo(4, 2.5, 4), stoneMat);
      base.position.y = 1.25;
      base.castShadow = true; base.receiveShadow = true;
      // Wood second floor
      const upper = new THREE.Mesh(boxGeo(3.6, 1.4, 3.6), woodMat);
      upper.position.y = 3.2;
      upper.castShadow = true;
      // Thatch roof
      const roof = new THREE.Mesh(coneGeo(3.0, 1.6, 4), thatchMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 4.7;
      roof.castShadow = true;
      // Team banner
      const pole = new THREE.Mesh(cylGeo(0.06, 0.06, 4, 6), woodMat);
      pole.position.set(2.0, 3, 0);
      const banner = new THREE.Mesh(boxGeo(0.6, 0.9, 0.05), teamClothMat);
      banner.position.set(2.3, 4.2, 0);
      banner.castShadow = true;
      // Door
      const door = new THREE.Mesh(boxGeo(1.0, 1.6, 0.1), woodMat);
      door.position.set(0, 0.8, 2.05);
      g.add(base, upper, roof, pole, banner, door);
      break;
    }
    case 'house': {
      const base = new THREE.Mesh(boxGeo(2.4, 1.6, 2.4), woodMat);
      base.position.y = 0.8;
      base.castShadow = true; base.receiveShadow = true;
      const roof = new THREE.Mesh(coneGeo(1.9, 1.3, 4), thatchMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 2.15;
      roof.castShadow = true;
      const door = new THREE.Mesh(boxGeo(0.5, 1.0, 0.05), woodMat);
      door.position.set(0, 0.5, 1.22);
      g.add(base, roof, door);
      break;
    }
    case 'barracks': {
      const base = new THREE.Mesh(boxGeo(3, 2, 3), woodMat);
      base.position.y = 1;
      base.castShadow = true; base.receiveShadow = true;
      const roof = new THREE.Mesh(coneGeo(2.3, 1.4, 4), thatchMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 2.7;
      roof.castShadow = true;
      // Weapon rack (training prop)
      const rack = new THREE.Mesh(boxGeo(0.05, 1.6, 1.4), woodMat);
      rack.position.set(0, 0.8, 1.51);
      const sword = new THREE.Mesh(boxGeo(0.04, 0.7, 0.04), metalMat);
      sword.position.set(0, 1.4, 1.55);
      const banner = new THREE.Mesh(boxGeo(0.5, 0.8, 0.04), teamClothMat);
      banner.position.set(0, 1.4, 1.52);
      g.add(base, roof, rack, sword, banner);
      break;
    }
    case 'archery_range': {
      const base = new THREE.Mesh(boxGeo(3, 2, 3), woodMat);
      base.position.y = 1;
      base.castShadow = true; base.receiveShadow = true;
      // Open front with awning
      const awning = new THREE.Mesh(boxGeo(3.4, 0.1, 1.4), thatchMat);
      awning.position.set(0, 2.2, 0.7);
      awning.rotation.x = -0.3;
      // Target dummy
      const dummy = new THREE.Mesh(cylGeo(0.4, 0.4, 1.6, 8), woodMat);
      dummy.position.set(0, 0.8, 1.4);
      g.add(base, awning, dummy);
      break;
    }
    case 'stable': {
      // Open stall with fence
      const floor = new THREE.Mesh(boxGeo(3.4, 0.1, 3.4), woodMat);
      floor.position.y = 0.05; floor.receiveShadow = true;
      const postFL = new THREE.Mesh(cylGeo(0.08, 0.08, 1.6, 6), woodMat);
      postFL.position.set(-1.6, 0.8, 1.6);
      const postFR = new THREE.Mesh(cylGeo(0.08, 0.08, 1.6, 6), woodMat);
      postFR.position.set(1.6, 0.8, 1.6);
      const postBL = new THREE.Mesh(cylGeo(0.12, 0.12, 2.6, 6), woodMat);
      postBL.position.set(-1.6, 1.3, -1.6);
      const postBR = new THREE.Mesh(cylGeo(0.12, 0.12, 2.6, 6), woodMat);
      postBR.position.set(1.6, 1.3, -1.6);
      const roof = new THREE.Mesh(coneGeo(2.5, 1.2, 4), thatchMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 3.2;
      roof.castShadow = true;
      // Feed trough
      const trough = new THREE.Mesh(boxGeo(1.5, 0.4, 0.5), woodMat);
      trough.position.set(0, 0.2, -1.2);
      [postFL, postFR, postBL, postBR, trough].forEach(m => m.castShadow = true);
      g.add(floor, postFL, postFR, postBL, postBR, roof, trough);
      break;
    }
    case 'siege_workshop': {
      const base = new THREE.Mesh(boxGeo(3.2, 2, 3.2), woodMat);
      base.position.y = 1; base.castShadow = true; base.receiveShadow = true;
      // Flat roof with crane
      const roof = new THREE.Mesh(boxGeo(3.6, 0.2, 3.6), woodMat);
      roof.position.y = 2.1; roof.castShadow = true;
      // Crane
      const craneBase = new THREE.Mesh(cylGeo(0.1, 0.1, 2.5, 6), woodMat);
      craneBase.position.set(-1, 2.2, 0); craneBase.castShadow = true;
      const craneArm = new THREE.Mesh(boxGeo(2.5, 0.1, 0.1), woodMat);
      craneArm.position.set(0.25, 3.4, 0); craneArm.castShadow = true;
      // Wheel (in progress)
      const wheel = new THREE.Mesh(cylGeo(0.5, 0.5, 0.1, 10), woodMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, 0.6, 1.65);
      g.add(base, roof, craneBase, craneArm, wheel);
      break;
    }
    case 'storage': {
      const base = new THREE.Mesh(boxGeo(2.4, 1.5, 2.4), woodMat);
      base.position.y = 0.75; base.castShadow = true; base.receiveShadow = true;
      // Roof
      const roof = new THREE.Mesh(coneGeo(1.9, 1.2, 4), thatchMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 2.1; roof.castShadow = true;
      // Storage crates
      const c1 = new THREE.Mesh(boxGeo(0.6, 0.6, 0.6), woodMat);
      c1.position.set(-1.4, 0.3, 1.0);
      const c2 = new THREE.Mesh(boxGeo(0.6, 0.6, 0.6), woodMat);
      c2.position.set(1.4, 0.3, 1.0);
      [c1, c2].forEach(m => m.castShadow = true);
      g.add(base, roof, c1, c2);
      break;
    }
    case 'tower': {
      // Stone tower with battlements
      const base = new THREE.Mesh(cylGeo(1.0, 1.2, 4, 8), stoneMat);
      base.position.y = 2; base.castShadow = true; base.receiveShadow = true;
      // Battlement ring
      const batt = new THREE.Mesh(cylGeo(1.15, 1.15, 0.4, 8), stoneMat);
      batt.position.y = 4.2; batt.castShadow = true;
      // Roof
      const roof = new THREE.Mesh(coneGeo(1.1, 1.0, 8), thatchMat);
      roof.position.y = 5.0; roof.castShadow = true;
      // Banner
      const pole = new THREE.Mesh(cylGeo(0.04, 0.04, 1.5, 6), woodMat);
      pole.position.set(0, 5.5, 0);
      const banner = new THREE.Mesh(boxGeo(0.4, 0.6, 0.03), teamClothMat);
      banner.position.set(0.2, 5.7, 0);
      g.add(base, batt, roof, pole, banner);
      break;
    }
    case 'wall': {
      const seg = new THREE.Mesh(boxGeo(1.4, 2.4, 1.4), stoneMat);
      seg.position.y = 1.2; seg.castShadow = true; seg.receiveShadow = true;
      const batt = new THREE.Mesh(boxGeo(1.5, 0.3, 1.5), stoneMat);
      batt.position.y = 2.55; batt.castShadow = true;
      g.add(seg, batt);
      break;
    }
  }

  // Selection/placement ring (hidden by default)
  const ringGeo = new THREE.RingGeometry(1.0, 1.2, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88, transparent: true, opacity: 0.0, side: THREE.DoubleSide,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.06;
  ring.renderOrder = 999;
  ring.name = 'selectionRing';
  g.add(ring);

  // HP bar (large)
  const w = 2.0;
  const hpBarBg = new THREE.Mesh(
    new THREE.PlaneGeometry(w, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthTest: false })
  );
  const yTop = type === 'town_center' ? 6 : type === 'tower' ? 6 : 3;
  hpBarBg.position.y = yTop; hpBarBg.renderOrder = 998;
  hpBarBg.visible = false; hpBarBg.name = 'hpBarBg';
  const hpBarFg = new THREE.Mesh(
    new THREE.PlaneGeometry(w, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x33ff66, transparent: true, opacity: 0.95, depthTest: false })
  );
  (hpBarFg.geometry as THREE.PlaneGeometry).translate(0.5, 0, 0);
  hpBarFg.position.set(-w / 2, yTop, 0.001);
  hpBarFg.renderOrder = 999;
  hpBarFg.visible = false; hpBarFg.name = 'hpBarFg';
  const hpGroup = new THREE.Group();
  hpGroup.name = 'hpBar';
  hpGroup.add(hpBarBg, hpBarFg);
  g.add(hpGroup);

  // Construction site (scaffolding) — visible only while under construction
  const scaffold = new THREE.Group();
  scaffold.name = 'scaffold';
  const sg1 = new THREE.Mesh(cylGeo(0.05, 0.05, 3, 4), woodMat);
  sg1.position.set(1.2, 1.5, 1.2);
  const sg2 = new THREE.Mesh(cylGeo(0.05, 0.05, 3, 4), woodMat);
  sg2.position.set(-1.2, 1.5, 1.2);
  const sg3 = new THREE.Mesh(cylGeo(0.05, 0.05, 3, 4), woodMat);
  sg3.position.set(1.2, 1.5, -1.2);
  const sg4 = new THREE.Mesh(cylGeo(0.05, 0.05, 3, 4), woodMat);
  sg4.position.set(-1.2, 1.5, -1.2);
  [sg1, sg2, sg3, sg4].forEach(m => m.castShadow = true);
  scaffold.add(sg1, sg2, sg3, sg4);
  scaffold.visible = false;
  g.add(scaffold);

  g.name = `building_${type}_${team}`;
  g.userData.buildingType = type;
  g.userData.team = team;
  return g;
}

// ----------------------------------------------------------------------------
// Resource node meshes (tree, gold ore, berry bush)
// ----------------------------------------------------------------------------
export function buildTreeMesh(variant: number): THREE.Group {
  const tex = getTextures();
  const g = new THREE.Group();
  const woodMat = standardMat({
    map: tex.wood.map, normalMap: tex.wood.normalMap,
    roughnessMap: tex.wood.roughnessMap, roughness: 0.9,
    color: 0x7a5a35,
  });
  const leafMat = standardMat({
    color: variant % 2 === 0 ? 0x3b6b2e : 0x4a7a37, roughness: 0.95,
  });
  const trunk = new THREE.Mesh(cylGeo(0.18, 0.28, 2.2, 6), woodMat);
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  // Canopy: 2-3 spheres stacked
  const c1 = new THREE.Mesh(sphGeo(0.9, 8), leafMat);
  c1.position.y = 2.2;
  c1.castShadow = true;
  const c2 = new THREE.Mesh(sphGeo(0.7, 8), leafMat);
  c2.position.set(0.3, 2.8, 0.1);
  c2.castShadow = true;
  const c3 = new THREE.Mesh(sphGeo(0.65, 8), leafMat);
  c3.position.set(-0.25, 2.7, -0.15);
  c3.castShadow = true;
  g.add(trunk, c1, c2, c3);
  g.userData.isResource = true;
  g.userData.resourceType = 'wood';
  return g;
}

export function buildGoldOreMesh(): THREE.Group {
  const tex = getTextures();
  const g = new THREE.Group();
  const rockMat = standardMat({
    map: tex.rock.map, normalMap: tex.rock.normalMap,
    roughnessMap: tex.rock.roughnessMap, roughness: 0.85, color: 0x9a8a6a,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffcc33, roughness: 0.3, metalness: 0.9,
    emissive: 0x553300, emissiveIntensity: 0.4,
  });
  // Rocky base mound
  for (let i = 0; i < 5; i++) {
    const r = 0.5 + Math.random() * 0.4;
    const m = new THREE.Mesh(sphGeo(r, 6), rockMat);
    m.position.set((Math.random() - 0.5) * 1.5, r * 0.5, (Math.random() - 0.5) * 1.5);
    m.scale.y = 0.7;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  // Gold veins
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(sphGeo(0.15 + Math.random() * 0.15, 6), goldMat);
    m.position.set(
      (Math.random() - 0.5) * 1.4,
      0.4 + Math.random() * 0.4,
      (Math.random() - 0.5) * 1.4,
    );
    m.castShadow = true;
    g.add(m);
  }
  g.userData.isResource = true;
  g.userData.resourceType = 'gold';
  return g;
}

export function buildBerryBushMesh(): THREE.Group {
  const g = new THREE.Group();
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x2e5a2a, roughness: 0.95 });
  const berryMat = new THREE.MeshStandardMaterial({
    color: 0xc0392b, roughness: 0.4,
    emissive: 0x551111, emissiveIntensity: 0.3,
  });
  // Bush
  const b1 = new THREE.Mesh(sphGeo(0.55, 8), bushMat);
  b1.position.y = 0.45;
  b1.scale.set(1.2, 0.9, 1.2);
  b1.castShadow = true;
  g.add(b1);
  // Berries
  for (let i = 0; i < 12; i++) {
    const berry = new THREE.Mesh(sphGeo(0.08, 5), berryMat);
    const a = (i / 12) * Math.PI * 2;
    berry.position.set(
      Math.cos(a) * (0.3 + Math.random() * 0.2),
      0.3 + Math.random() * 0.4,
      Math.sin(a) * (0.3 + Math.random() * 0.2),
    );
    g.add(berry);
  }
  g.userData.isResource = true;
  g.userData.resourceType = 'food';
  return g;
}
