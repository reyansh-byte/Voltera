import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// ─────────────────────────────────────────────────────────────
// SHARED MATERIALS
// ─────────────────────────────────────────────────────────────
const makeMats = () => ({
  wall:     new THREE.MeshStandardMaterial({ color: 0xe8d9c0, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide }),
  roofTile: new THREE.MeshStandardMaterial({ color: 0x7a3a1a, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide }),
  flatRoof: new THREE.MeshStandardMaterial({ color: 0x606060, roughness: 0.9,  metalness: 0.0, side: THREE.DoubleSide }),
  gableEnd: new THREE.MeshStandardMaterial({ color: 0xdcccaa, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide }),
  panel:    new THREE.MeshStandardMaterial({ color: 0x0d1f35, roughness: 0.2,  metalness: 0.8, side: THREE.DoubleSide }),
  obstacle: new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8,  metalness: 0.0, side: THREE.DoubleSide }),
  chimney:  new THREE.MeshStandardMaterial({ color: 0x7a2000, roughness: 0.9,  metalness: 0.0, side: THREE.DoubleSide }),
  ground:   new THREE.MeshStandardMaterial({ color: 0x3a5f3a, roughness: 0.95, metalness: 0.0 }),
  trunk:    new THREE.MeshStandardMaterial({ color: 0x7a3b10, roughness: 0.9,  metalness: 0.0 }),
  foliage:  new THREE.MeshStandardMaterial({ color: 0x1e7a1e, roughness: 0.95, metalness: 0.0 }),
});

// ─────────────────────────────────────────────────────────────
// POINT-IN-POLYGON (XZ plane)
// ─────────────────────────────────────────────────────────────
const pip = (px, pz, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    if (((zi > pz) !== (zj > pz)) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
};

// ─────────────────────────────────────────────────────────────
// WALLS — perimeter segments
// ─────────────────────────────────────────────────────────────
// addWalls: builds each wall segment to exactly meet the roof.
// For each edge, samples surfaceY at both endpoints (slightly inward
// so we get the roof height above that vertex) to get ha and hb.
// - If ha ≈ hb → flat-top box wall (eave side or ridge side)
// - If ha ≠ hb → trapezoidal wall using a custom quad mesh so the
//   top edge follows the roof slope exactly, no gaps anywhere.
const addWalls = (pts, wallH, mat, scene, eaveHFn = null) => {
  const INSET = 0.15; // sample slightly inside polygon to get roof height

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;

    let ha = wallH, hb = wallH;
    if (eaveHFn) {
      // Inward normal (into polygon) so we sample inside the roof
      const nx = -dz / len, nz = dx / len;
      ha = Math.max(eaveHFn(a.x + nx*INSET, a.z + nz*INSET), wallH);
      hb = Math.max(eaveHFn(b.x + nx*INSET, b.z + nz*INSET), wallH);
    }

    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const angle = -Math.atan2(dz, dx);
    const THICK = 0.22;

    if (Math.abs(ha - hb) < 0.05) {
      // Flat-top wall — simple box
      const h = (ha + hb) / 2;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(len, h, THICK), mat);
      mesh.position.set(mx, h / 2, mz);
      mesh.rotation.y = angle;
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    } else {
      // Sloped-top wall — build as a custom quad (trapezoid)
      // 4 vertices: bottom-left, bottom-right, top-right(hb), top-left(ha)
      const geo = new THREE.BufferGeometry();
      const half = len / 2;
      // In local space: x along edge, y up, z = ±THICK/2
      const verts = new Float32Array([
        // front face
        -half, 0,    THICK/2,   // 0 BL
         half, 0,    THICK/2,   // 1 BR
         half, hb,   THICK/2,   // 2 TR
        -half, ha,   THICK/2,   // 3 TL
        // back face
        -half, 0,   -THICK/2,   // 4 BL
         half, 0,   -THICK/2,   // 5 BR
         half, hb,  -THICK/2,   // 6 TR
        -half, ha,  -THICK/2,   // 7 TL
      ]);
      const idx = new Uint16Array([
        0,1,2, 0,2,3,   // front
        5,4,7, 5,7,6,   // back
        4,0,3, 4,3,7,   // left
        1,5,6, 1,6,2,   // right
        3,2,6, 3,6,7,   // top
        4,5,1, 4,1,0,   // bottom
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(mx, 0, mz);
      mesh.rotation.y = angle;
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
};

// ─────────────────────────────────────────────────────────────
// GABLE ROOF
// Ridge runs along the LONG axis of the building automatically.
// pitchRatio = rise/run (5:12 = 0.4167)
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────
// POLYGON-CLIPPED SLOPED ROOF
//
// Strategy: build the roof as a fan of triangles from the polygon
// eave edges up to a ridge line (or centroid peak if no ridge).
// All geometry is strictly bounded by the polygon footprint —
// nothing overhangs the walls. No visible ridge cap box.
//
// Ridge logic:
//   - ridgeSegs provided → find the dominant axis, project each
//     eave vertex onto the ridge line to get its apex, height
//     comes from distance-to-ridge × pitchRatio.
//   - No ridgeSegs → use polygon centroid as the apex (pyramid /
//     hip shape fully contained).
// ─────────────────────────────────────────────────────────────



// Build a single triangle mesh (always double-sided via material)
const mkTri=(mat,scene,ax,ay,az,bx,by,bz,cx,cy,cz)=>{
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(
    new Float32Array([ax,ay,az,bx,by,bz,cx,cy,cz]),3));
  g.computeVertexNormals();
  const m=new THREE.Mesh(g,mat);
  m.castShadow=m.receiveShadow=true;
  scene.add(m);
};

const addHipRoof = (pts, wallH, pitchRatio, mats, scene, ridgeSegs=[]) => {
  const xs=pts.map(p=>p.x), zs=pts.map(p=>p.z);
  const minX=Math.min(...xs), maxX=Math.max(...xs);
  const minZ=Math.min(...zs), maxZ=Math.max(...zs);
  const W=maxX-minX, L=maxZ-minZ;
  const cX=(minX+maxX)/2, cZ=(minZ+maxZ)/2;

  // ── Pick ridge ────────────────────────────────────────────────
  let ridge = (ridgeSegs && ridgeSegs.length > 0) ? ridgeSegs.reduce((best,s)=>{
    const l=Math.hypot(s.x2-s.x1,s.z2-s.z1);
    return(!best||l>Math.hypot(best.x2-best.x1,best.z2-best.z1))?s:best;
  }, null) : null;

  if (!ridge) {
    // Auto-ridge along longest axis
    if (W >= L) ridge = { x1:minX, z1:cZ, x2:maxX, z2:cZ };
    else         ridge = { x1:cX,  z1:minZ, x2:cX,  z2:maxZ };
  }

  const rdx=ridge.x2-ridge.x1, rdz=ridge.z2-ridge.z1;
  const rlen=Math.hypot(rdx,rdz)||1;
  const perpX=-rdz/rlen, perpZ=rdx/rlen;
  const rMidX=(ridge.x1+ridge.x2)/2, rMidZ=(ridge.z1+ridge.z2)/2;

  // Signed perpendicular distance from the ridge line
  const distToRidge = (x,z) =>
    (x-rMidX)*perpX + (z-rMidZ)*perpZ;

  const maxDist = Math.max(...pts.map(p=>Math.abs(distToRidge(p.x,p.z))), 0.1);
  const ridgeH  = wallH + maxDist * pitchRatio;

  // ── Build clean planar faces ──────────────────────────────────
  // For each eave edge A→B, project A and B onto the ridge line
  // to get their apex positions, then draw a flat quad.
  // This gives real architectural flat-plane faces with sharp ridges.
  let maxRidgeY = wallH;

  for (let i=0; i<pts.length; i++) {
    const a=pts[i], b=pts[(i+1)%pts.length];

    const da=distToRidge(a.x,a.z);
    const db=distToRidge(b.x,b.z);

    // Eave heights — wallH + (maxDist - |dist|) * pitch
    const ay = wallH + (maxDist - Math.abs(da)) * pitchRatio;
    const by = wallH + (maxDist - Math.abs(db)) * pitchRatio;

    // Project eave points onto ridge to get apex positions
    const apAx = a.x - da*perpX,  apAz = a.z - da*perpZ;
    const apBx = b.x - db*perpX,  apBz = b.z - db*perpZ;

    maxRidgeY = Math.max(maxRidgeY, ay, by, ridgeH);

    // Two triangles = one clean flat roof face
    mkTri(mats.roofTile, scene,
      a.x,   ay,     a.z,
      b.x,   by,     b.z,
      apBx,  ridgeH, apBz
    );
    mkTri(mats.roofTile, scene,
      a.x,   ay,     a.z,
      apBx,  ridgeH, apBz,
      apAx,  ridgeH, apAz
    );
  }

  // surfaceY for panel placement — linear from wallH at eave to ridgeH at ridge
  const surfaceY = (qx,qz) => {
    const d = Math.abs(distToRidge(qx,qz));
    return wallH + (maxDist - Math.min(d, maxDist)) * pitchRatio;
  };

  return {
    ridgeY: maxRidgeY, peakY: ridgeH, pitchRatio,
    ridgeAlongZ: L>=W, allSlopes:[],
    footprint:pts,
    roofBounds:{minX,maxX,minZ,maxZ,W,L,cX,cZ},
    surfaceY, cX, cZ,
  };
};

// ─────────────────────────────────────────────────────────────
// GABLE ROOF — delegates to addHipRoof with a fixed centre ridge
// ─────────────────────────────────────────────────────────────
const addGableRoof = (pts, wallH, pitchRatio, mats, scene) => {
  const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const W = maxX - minX, L = maxZ - minZ;
  const cX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cZ = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const ridgeAlongZ = W <= L;
  const ridgeSeg = ridgeAlongZ
    ? { x1: cX, z1: minZ, x2: cX, z2: maxZ }
    : { x1: minX, z1: cZ, x2: maxX, z2: cZ };
  return addHipRoof(pts, wallH, pitchRatio, mats, scene, [ridgeSeg]);
};
// ─────────────────────────────────────────────────────────────
// PANELS ON SLOPED ROOF
// Uses roofInfo.surfaceY — the exact same height function used
// to build the grid-based roof geometry. No triangle lookup needed.
// ─────────────────────────────────────────────────────────────
const placePanelsHip = (roofInfo, wallH, obsFPs, panelMat, scene) => {
  const { footprint, roofBounds, surfaceY } = roofInfo;
  const { minX, maxX, minZ, maxZ } = roofBounds;
  const ridgeY = roofInfo.ridgeY;

  const PW = 1.0, PH = 0.04, PL = 1.65, GAP = 0.1, BORDER = 0.5;
  const geo = new THREE.BoxGeometry(PW, PH, PL);
  const group = new THREE.Group();
  let count = 0;
  const halfW = PW / 2, halfL = PL / 2;

  // roofY uses the exact same surfaceY passed from addHipRoof,
  // or falls back to wallH if surfaceY is not available.
  const roofY = surfaceY
    ? (px, pz) => Math.max(surfaceY(px, pz), wallH)
    : (px, pz) => wallH;

  // Gradient-based panel tilt from the exact surface
  const SAMPLE = 0.3;
  const panelRotation = (cx, cz) => {
    const dydx = (roofY(cx+SAMPLE,cz) - roofY(cx-SAMPLE,cz)) / (2*SAMPLE);
    const dydz = (roofY(cx,cz+SAMPLE) - roofY(cx,cz-SAMPLE)) / (2*SAMPLE);
    return { rotX: -Math.atan(dydz), rotZ: Math.atan(dydx) };
  };

  // 9-point footprint check — all sample points inside polygon
  const panelFits = (px, pz) => {
    const checks = [
      {x:px,       z:pz      }, {x:px+PW,    z:pz      },
      {x:px+PW,    z:pz+PL   }, {x:px,        z:pz+PL   },
      {x:px+halfW, z:pz      }, {x:px+halfW,  z:pz+PL   },
      {x:px,       z:pz+halfL}, {x:px+PW,     z:pz+halfL},
      {x:px+halfW, z:pz+halfL},
    ];
    return checks.every(p => pip(p.x, p.z, footprint));
  };

  for (let px = minX+BORDER; px+PW <= maxX-BORDER; px += PW+GAP) {
    for (let pz = minZ+BORDER; pz+PL <= maxZ-BORDER; pz += PL+GAP) {
      const cx = px+halfW, cz = pz+halfL;
      if (!panelFits(px, pz)) continue;
      if (obsFPs.some(o => pip(cx, cz, o))) continue;

      // Skip panels on flat eave areas (not on any slope)
      const centreY = roofY(cx, cz);
      if (centreY <= wallH + 0.1) continue;

      const avgY = (roofY(px,    pz   )+roofY(px+PW,pz   )+
                    roofY(px+PW,pz+PL)+roofY(px,   pz+PL)) / 4;
      const wy = Math.min(Math.max(avgY, wallH), ridgeY) + PH/2;

      const { rotX, rotZ } = panelRotation(cx, cz);
      const m = new THREE.Mesh(geo, panelMat);
      m.position.set(cx, wy, cz);
      m.rotation.order = 'ZXY';
      m.rotation.x = rotX;
      m.rotation.z = rotZ;
      m.castShadow = true;
      group.add(m);
      count++;
    }
  }

  scene.add(group);
  return count;
};
// ─────────────────────────────────────────────────────────────
// POLYGON SHAPE HELPER — builds a THREE.Shape from {x,z} points
// ─────────────────────────────────────────────────────────────
const polyToShape = (pts) => {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].z);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].z);
  shape.closePath();
  return shape;
};

// ─────────────────────────────────────────────────────────────
// FLAT ROOF SLAB — clipped exactly to the polygon footprint
// ─────────────────────────────────────────────────────────────
const addFlatRoof = (pts, wallH, mat, scene) => {
  const shape = polyToShape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false });
  const slab = new THREE.Mesh(geo, mat);
  slab.rotation.x = Math.PI / 2;
  slab.position.y = wallH + 0.25;
  slab.castShadow = slab.receiveShadow = true;
  scene.add(slab);
  return { roofSurfaceY: wallH + 0.25 };
};

// Gable panel placement reuses the hip placer — same polygon-clipped grid
const placePanelsGable = (roofInfo, wallH, obsFPs, panelMat, scene) =>
  placePanelsHip(roofInfo, wallH, obsFPs, panelMat, scene);

// ─────────────────────────────────────────────────────────────
// PANELS ON FLAT ROOF
// Checks ALL 4 corners of each panel against the polygon so no
// panel body can overhang the edge. BORDER adds a clean setback.
// ─────────────────────────────────────────────────────────────
const placePanelsFlat = (footprint, obsFPs, roofY, panelMat, scene) => {
  const PW     = 1.0;   // panel width  (metres)
  const PL     = 1.65;  // panel length
  const GAP    = 0.08;  // gap between panels
  const BORDER = 0.5;   // setback from every polygon edge

  // Bounding box for the grid loop — panels start and end inside BORDER
  const xs = footprint.map(p => p.x), zs = footprint.map(p => p.z);
  const minX = Math.min(...xs) + BORDER;
  const maxX = Math.max(...xs) - BORDER;
  const minZ = Math.min(...zs) + BORDER;
  const maxZ = Math.max(...zs) - BORDER;

  // Helper: returns true only if ALL 4 corners of a panel cell are inside
  const panelFits = (px, pz) => {
    const corners = [
      { x: px,      z: pz      },
      { x: px + PW, z: pz      },
      { x: px + PW, z: pz + PL },
      { x: px,      z: pz + PL },
    ];
    return corners.every(c => pip(c.x, c.z, footprint))
      && !obsFPs.some(obs => corners.some(c => pip(c.x, c.z, obs)));
  };

  const geo   = new THREE.BoxGeometry(PW, 0.04, PL);
  const group = new THREE.Group();
  let count   = 0;

  for (let px = minX; px + PW <= maxX; px += PW + GAP) {
    for (let pz = minZ; pz + PL <= maxZ; pz += PL + GAP) {
      if (!panelFits(px, pz)) continue;
      const m = new THREE.Mesh(geo, panelMat);
      m.position.set(px + PW / 2, roofY + 0.1, pz + PL / 2);
      m.castShadow = true;
      group.add(m);
      count++;
    }
  }
  scene.add(group);
  return count;
};

// ─────────────────────────────────────────────────────────────
// BUILDING FROM BLUEPRINT
// Uses Claude-extracted dimensions to build a properly-scaled
// footprint. Falls back to pixel-derived polygon only if no
// real dimensions were extracted.
// ─────────────────────────────────────────────────────────────
const buildFromBlueprint = (bp, mats, scene) => {
  const wallHeight = bp.wallHeight  || 14;
  // Enforce minimum pitch of 2:12 — gentler slope looks better on large buildings
  const roofPitch  = Math.max(bp.roofPitch || 0.2, 0.167);
  const FT = 0.3048;

  // ── Step 1: Get the polygon footprint in metres ──────────────
  let rawFootprint;
  const rawPoly = bp.polygon;
  if (rawPoly && rawPoly.length >= 3) {
    const cx0 = rawPoly.reduce((s, p) => s + p.x, 0) / rawPoly.length;
    const cy0 = rawPoly.reduce((s, p) => s + p.y, 0) / rawPoly.length;
    rawFootprint = rawPoly.map(p => ({
      x: (p.x - cx0) * FT,
      z: (p.y - cy0) * FT,
    }));
    if (bp.dimensions?.width && bp.dimensions?.length) {
      const xs = rawFootprint.map(p => p.x), zs = rawFootprint.map(p => p.z);
      const curW = Math.max(...xs) - Math.min(...xs);
      const curL = Math.max(...zs) - Math.min(...zs);
      const targW = bp.dimensions.width  * FT;
      const targL = bp.dimensions.length * FT;
      if (curW > 0.1) rawFootprint = rawFootprint.map(p => ({ x: p.x * (targW / curW), z: p.z }));
      if (curL > 0.1) rawFootprint = rawFootprint.map(p => ({ x: p.x, z: p.z * (targL / curL) }));
    }
  } else if (bp.dimensions?.width && bp.dimensions?.length) {
    const W = bp.dimensions.width  * FT;
    const L = bp.dimensions.length * FT;
    rawFootprint = [
      { x: -W/2, z: -L/2 }, { x: W/2, z: -L/2 },
      { x:  W/2, z:  L/2 }, { x: -W/2, z:  L/2 },
    ];
  } else {
    throw new Error('No polygon or dimensions available.');
  }

  // ── Step 2: Use actual polygon for both walls AND roof ──
  // The polygon footprint drives all geometry — walls trace the exact
  // shape, and the roof uses the same polygon so the brown tiles sit
  // precisely within the drawn outline.
  const allXs = rawFootprint.map(p => p.x);
  const allZs = rawFootprint.map(p => p.z);
  const bMinX = Math.min(...allXs), bMaxX = Math.max(...allXs);
  const bMinZ = Math.min(...allZs), bMaxZ = Math.max(...allZs);

  // Use the actual polygon footprint (not a simplified bounding box)
  const footprint = rawFootprint;

  // ── Step 3: Determine roof type ─────────────────────────────
  const aiType  = (bp.roofType  || 'hip').toLowerCase();
  const aiShape = (bp.roofShape || '').toLowerCase();
  const isFlat  = aiType === 'flat' || aiType === 'shed';
  // Only use gable if EXPLICITLY 'gable' AND simple rectangle shape
  const isGable = !isFlat && aiType === 'gable' && 
                  (aiShape === 'rectangle' || aiShape === '');
  // Everything else → hip (handles complex, l-shape, irregular, hip, unknown)
  const isHip   = !isFlat && !isGable;

  console.log(`Blueprint: bbox ${(bMaxX-bMinX).toFixed(1)}×${(bMaxZ-bMinZ).toFixed(1)}m, pts=${rawFootprint.length}, aiType=${aiType}, aiShape=${aiShape} → isHip=${isHip}, isGable=${isGable}`);

  const wallH = wallHeight * FT;

  // Walls: use bounding box only — polygon walls with many points
  // create visual artifacts and jagged geometry.
  // The clean rectangular outer perimeter looks correct for all roof types.
  // Walls added after roof is built so they can match eave height dynamically

  // chimneyFPs: footprint polygons of each chimney for panel exclusion
  const chimneyFPs = [];

  const addChimneys = (ridgeY, roofInfo = null) => {
    (bp.features?.chimneys || []).forEach((ch) => {
      // ch now has {x, y, width, length} in real-world feet — use directly.
      // Fall back to evenly-spaced if position not available (AI mode).
      const FTc = 0.3048;
      let cx, cz, cw, cl;
      if (ch.x != null && ch.y != null) {
        // Manual mode: convert from feet (polygon-space) to metres
        const allXs = footprint.map(p => p.x), allZs = footprint.map(p => p.z);
        const bMinX = Math.min(...allXs), bMinZ = Math.min(...allZs);
        const bW = Math.max(...allXs) - bMinX, bL = Math.max(...allZs) - bMinZ;
        cx = bMinX + (ch.x / (bp.dimensions?.width  || 60)) * bW;
        cz = bMinZ + (ch.y / (bp.dimensions?.length || 60)) * bL;
        cw = Math.max((ch.width  || 2) * FTc, 0.5);
        cl = Math.max((ch.length || 2) * FTc, 0.5);
      } else {
        // AI mode fallback: evenly space along centre of building
        const xs = footprint.map(p => p.x), zs = footprint.map(p => p.z);
        const idx = (bp.features.chimneys || []).indexOf(ch);
        const total = (bp.features.chimneys || []).length;
        const ratio = (idx + 1) / (total + 1);
        cx = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * ratio;
        cz = (Math.min(...zs) + Math.max(...zs)) / 2;
        cw = 0.7; cl = 0.7;
      }

      // Sit on the actual roof surface at this x/z position
      const chH = 1.2;
      const roofBase = roofInfo ? roofInfo.surfaceY(cx, cz) : ridgeY;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(cw, chH, cl), mats.chimney
      );
      // Position so bottom of chimney is at roof surface, top sticks up
      mesh.position.set(cx, roofBase + chH / 2, cz);
      mesh.castShadow = true;
      scene.add(mesh);

      // Register as a panel exclusion zone (footprint polygon)
      chimneyFPs.push([
        { x: cx - cw/2, z: cz - cl/2 },
        { x: cx + cw/2, z: cz - cl/2 },
        { x: cx + cw/2, z: cz + cl/2 },
        { x: cx - cw/2, z: cz + cl/2 },
      ]);
    });
  };

  let panelCount;

  if (isFlat) {
    addWalls(footprint, wallH, mats.wall, scene);
    const { roofSurfaceY } = addFlatRoof(footprint, wallH, mats.flatRoof, scene);
    panelCount = placePanelsFlat(footprint, [], roofSurfaceY, mats.panel, scene);
    return { panelCount, roofSurfaceY };

  } else if (isGable) {
    const roofInfo = addGableRoof(footprint, wallH, roofPitch, mats, scene);
    addWalls(footprint, wallH, mats.wall, scene, roofInfo.surfaceY);
    addChimneys(roofInfo.ridgeY, roofInfo);
    panelCount = placePanelsGable(roofInfo, wallH, chimneyFPs, mats.panel, scene);
    return { panelCount, roofSurfaceY: roofInfo.ridgeY };

  } else {
    // Hip — default for all complex/irregular/unknown shapes
    // Apply EXACT same transform as rawFootprint to ridge lines:
    // 1. subtract polygon centroid, 2. * FT, 3. scale by same targW/targL ratio
    const rawPoly2 = bp.polygon;
    const cx0 = rawPoly2.reduce((s,p)=>s+p.x,0) / rawPoly2.length;
    const cy0 = rawPoly2.reduce((s,p)=>s+p.y,0) / rawPoly2.length;

    // Compute the same scale factors used for rawFootprint
    const preFP = rawPoly2.map(p => ({ x:(p.x-cx0)*FT, z:(p.y-cy0)*FT }));
    const pxs = preFP.map(p=>p.x), pzs = preFP.map(p=>p.z);
    const curW = Math.max(...pxs)-Math.min(...pxs);
    const curL = Math.max(...pzs)-Math.min(...pzs);
    const targW = (bp.dimensions?.width  || 60) * FT;
    const targL = (bp.dimensions?.length || 60) * FT;
    const scaleX = curW > 0.1 ? targW/curW : 1;
    const scaleZ = curL > 0.1 ? targL/curL : 1;

    const toMetre = (fx, fy) => ({
      x: (fx - cx0) * FT * scaleX,
      z: (fy - cy0) * FT * scaleZ,
    });

    const userRidgeLines = (bp.ridgeLines || []).map(rl => ({
      x1: toMetre(rl.x1, rl.y1).x,  z1: toMetre(rl.x1, rl.y1).z,
      x2: toMetre(rl.x2, rl.y2).x,  z2: toMetre(rl.x2, rl.y2).z,
    }));

    const roofInfo = addHipRoof(footprint, wallH, roofPitch, mats, scene, userRidgeLines);
    addWalls(footprint, wallH, mats.wall, scene, roofInfo.surfaceY);
    addChimneys(roofInfo.ridgeY, roofInfo);
    panelCount = placePanelsHip(roofInfo, wallH, chimneyFPs, mats.panel, scene);
    return { panelCount, roofSurfaceY: roofInfo.ridgeY };
  }
};

// ─────────────────────────────────────────────────────────────
// BUILDING FROM MAP POLYGON
// Flat roof by default (no ridges drawn).
// If ridgeLines are passed in, builds a proper sloped hip roof
// with the ridge aligned exactly to the drawn line.
// ─────────────────────────────────────────────────────────────
const buildFromMapPolygon = (roofPolygon, obstacles, mats, scene, ridgeLines = []) => {
  if (!roofPolygon || roofPolygon.length < 3)
    throw new Error('Need at least 3 polygon points. Draw a roof outline on the map first.');

  const cLat = roofPolygon.reduce((s, p) => s + p.lat, 0) / roofPolygon.length;
  const cLng = roofPolygon.reduce((s, p) => s + p.lng, 0) / roofPolygon.length;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos(cLat * Math.PI / 180);

  const toXZ = p => ({
    x: (p.lng - cLng) * mPerLng,
    z: (p.lat - cLat) * mPerLat,
  });

  const footprint = roofPolygon.map(toXZ);
  const WALL_H = 3.5; // base wall height — walls grow dynamically to meet eave

  // Obstacles — rendered as polygon-shaped raised boxes
  const obsFPs = [];
  (obstacles || []).forEach(obs => {
    if (!obs || obs.length < 3) return;
    try {
      const op = obs.map(toXZ);
      obsFPs.push(op);
      const shape = polyToShape(op);
      const geo   = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false });
      const m     = new THREE.Mesh(geo, mats.obstacle);
      m.rotation.x = Math.PI / 2;
      m.position.y  = WALL_H + 0.35;
      m.castShadow  = true;
      scene.add(m);
    } catch (e) { /* skip bad obstacles */ }
  });

  const hasRidges = Array.isArray(ridgeLines) && ridgeLines.length > 0;

  if (!hasRidges) {
    // ── FLAT ROOF ── walls fixed height, roof flat on top
    addWalls(footprint, WALL_H, mats.wall, scene);
    const { roofSurfaceY } = addFlatRoof(footprint, WALL_H, mats.flatRoof, scene);
    const panelCount = placePanelsFlat(footprint, obsFPs, roofSurfaceY, mats.panel, scene);
    return { panelCount, roofSurfaceY };
  }

  // ── SLOPED ROOF ── only when user explicitly draws a ridge line
  // Convert ridge lat/lng points to XZ metres using same transform
  const ridgeSegs = ridgeLines.map(rl => ({
    x1: toXZ({ lat: rl.lat1, lng: rl.lng1 }).x,
    z1: toXZ({ lat: rl.lat1, lng: rl.lng1 }).z,
    x2: toXZ({ lat: rl.lat2, lng: rl.lng2 }).x,
    z2: toXZ({ lat: rl.lat2, lng: rl.lng2 }).z,
  }));

  const roofInfo = addHipRoof(footprint, WALL_H, 0.2, mats, scene, ridgeSegs);
  addWalls(footprint, WALL_H, mats.wall, scene, roofInfo.surfaceY);
  const panelCount = placePanelsHip(roofInfo, WALL_H, obsFPs, mats.panel, scene);
  return { panelCount, roofSurfaceY: roofInfo.ridgeY };
};

// ─────────────────────────────────────────────────────────────
// ENVIRONMENT — trees scale with building size
// ─────────────────────────────────────────────────────────────
const addEnvironment = (mats, scene, buildingSize = 15) => {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Place trees at a distance proportional to building size
  const d = buildingSize * 1.8;
  const treePositions = [
    [-d * 0.9, -d * 0.7], [d * 0.95, -d * 0.65],
    [-d * 0.8,  d * 0.85], [d,  d * 0.75],
    [-d * 0.35, -d], [d * 0.7, -d * 0.9],
  ];

  // Tree size proportional to building
  const trunkH  = buildingSize * 0.18;
  const trunkR  = buildingSize * 0.018;
  const foliageR = buildingSize * 0.13;

  treePositions.forEach(([tx, tz]) => {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(trunkR, trunkR * 1.3, trunkH, 7),
      mats.trunk
    );
    trunk.position.set(tx, trunkH / 2, tz);
    trunk.castShadow = true;
    scene.add(trunk);

    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(foliageR, 8, 7),
      mats.foliage
    );
    leaves.position.set(tx, trunkH + foliageR * 0.7, tz);
    leaves.castShadow = true;
    scene.add(leaves);
  });
};

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
const EnhancedSolarPanel3D = ({ blueprintData, roofPolygon, obstacles, ridgeLines, show3D, onClose }) => {
  const mountRef    = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef    = useRef(null);    // stored so PDF export can re-render
  const cameraRef   = useRef(null);    // stored so PDF export can re-render
  const [panelCount,    setPanelCount]    = useState(0);
  const [totalCapacity, setTotalCapacity] = useState(0);
  const [buildingInfo,  setBuildingInfo]  = useState(null);
  const [skylightCount, setSkylightCount] = useState(0);
  const [ventCount,     setVentCount]     = useState(0);
  const [error,         setError]         = useState(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  useEffect(() => {
    if (!show3D || !mountRef.current) return;
    const mount = mountRef.current;
    setError(null); setPanelCount(0); setTotalCapacity(0); setBuildingInfo(null);
    setSkylightCount(0); setVentCount(0);

    let renderer, controls, animId;

    try {
      if (!blueprintData && !roofPolygon)
        throw new Error('No building data provided. Draw a roof on the map or upload a blueprint.');

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x87ceeb);
      scene.fog = new THREE.FogExp2(0xa8d4e8, 0.005);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(52, mount.clientWidth / mount.clientHeight, 0.1, 2000);
      camera.position.set(30, 24, 30);
      camera.lookAt(0, 4, 0);
      cameraRef.current = camera;

      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      rendererRef.current = renderer;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      mount.appendChild(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.minDistance = 2;
      controls.maxDistance = 800;

      // Lighting
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const sun = new THREE.DirectionalLight(0xfff4d6, 1.1);
      sun.position.set(35, 55, 25);
      sun.castShadow = true;
      sun.shadow.mapSize.width = sun.shadow.mapSize.height = 2048;
      Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 400 });
      scene.add(sun);
      scene.add(new THREE.HemisphereLight(0x87ceeb, 0x446644, 0.4));

      const mats = makeMats();

      let result;
      if (blueprintData) {
        result = buildFromBlueprint(blueprintData, mats, scene);
        setBuildingInfo({
          type:       blueprintData.buildingType || null,
          roofType:   blueprintData.roofType     || null,
          dimensions: blueprintData.dimensions   || null,
          pitch:      blueprintData.roofPitchNotation || null,
        });
        setSkylightCount(blueprintData.skylightCount || (blueprintData.features?.skylights?.length ?? 0));
        setVentCount(blueprintData.ventCount || (blueprintData.features?.vents?.length ?? 0));
      } else {
        result = buildFromMapPolygon(roofPolygon, obstacles, mats, scene, ridgeLines || []);
      }

      // ── Auto-fit camera to building ──────────────────────────────────
      // Only measure building meshes (exclude ground plane)
      const box = new THREE.Box3();
      scene.traverse(obj => {
        if (obj.isMesh && obj !== scene) {
          // Skip the ground plane (very flat, huge)
          const b = new THREE.Box3().setFromObject(obj);
          const h = b.max.y - b.min.y;
          if (h > 0.1) box.expandByObject(obj); // skip flat ground
        }
      });

      const bSize   = new THREE.Vector3();
      const bCenter = new THREE.Vector3();
      if (!box.isEmpty()) {
        box.getSize(bSize);
        box.getCenter(bCenter);
      } else {
        bSize.set(20, 8, 20);
        bCenter.set(0, 4, 0);
      }

      const maxDim     = Math.max(bSize.x, bSize.z);
      const buildingSpan = maxDim;
      const dist       = maxDim * 2.0;

      // Position camera at ~35° elevation angle so roof slopes are clearly visible
      // Not too high (roof looks flat) not too low (can't see top)
      const elevationAngle = Math.PI / 5; // 36 degrees
      const horizDist = dist * Math.cos(elevationAngle);
      const vertDist  = dist * Math.sin(elevationAngle) + bSize.y * 0.5;

      camera.position.set(
        bCenter.x + horizDist * 0.7,
        bCenter.y + vertDist,
        bCenter.z + horizDist * 0.7
      );
      const lookY = Math.max(bCenter.y * 0.4, bSize.y * 0.3);
      camera.lookAt(bCenter.x, lookY, bCenter.z);
      controls.target.set(bCenter.x, lookY, bCenter.z);
      controls.minDistance = maxDim * 0.2;
      controls.maxDistance = maxDim * 7;
      controls.update();

      // ── Add environment scaled to building size ──────────────────────
      addEnvironment(mats, scene, buildingSpan);

      const cap = result.panelCount * 0.4;
      setPanelCount(result.panelCount);
      setTotalCapacity(cap);

      const animate = () => {
        animId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      const onResize = () => {
        if (!mount) return;
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      };
      window.addEventListener('resize', onResize);

      return () => {
        cancelAnimationFrame(animId);
        window.removeEventListener('resize', onResize);
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
        renderer.dispose();
        controls.dispose();
        scene.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
        Object.values(mats).forEach(m => m.dispose());
      };

    } catch (err) {
      console.error('3D scene error:', err);
      setError(err.message);
    }
  }, [show3D, blueprintData, roofPolygon, obstacles, ridgeLines]);

  // ── PDF Export ────────────────────────────────────────────────
  const exportPDF = async () => {
    setPdfGenerating(true);
    try {
      // Capture the 3D canvas — re-render with stored scene+camera refs
      let imgDataUrl = '';
      const renderer = rendererRef.current;
      const scene    = sceneRef.current;
      const camera   = cameraRef.current;

      if (renderer && scene && camera) {
        // Force a fresh render so preserveDrawingBuffer captures latest frame
        renderer.render(scene, camera);
        imgDataUrl = renderer.domElement.toDataURL('image/png');
      } else if (renderer) {
        // Fallback: grab whatever is currently on the canvas
        imgDataUrl = renderer.domElement.toDataURL('image/png');
      }

      const annualKwhCalc   = totalCapacity * 1400;
      const savingsLakhCalc = (annualKwhCalc * 7.5) / 100000;
      const systemCost      = totalCapacity * 60000;
      let subsidy = 0;
      if (totalCapacity <= 3)       subsidy = totalCapacity * 18000;
      else if (totalCapacity <= 10) subsidy = 3 * 18000 + (totalCapacity - 3) * 9000;
      else                          subsidy = 3 * 18000 + 7 * 9000;
      const netCost    = systemCost - subsidy;
      const payback    = netCost / (annualKwhCalc * 7.5);
      const now        = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });

      // Build HTML for the PDF
      const html = `
<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Solar Report</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', sans-serif; background:#f5f7fa; color:#1a1a2e; }
  .page { max-width:900px; margin:0 auto; padding:40px; }
  .header { background:linear-gradient(135deg,#0f1932,#1a3a6b); color:#fff; padding:32px 40px; border-radius:12px; margin-bottom:28px; }
  .header h1 { font-size:26px; letter-spacing:0.5px; margin-bottom:6px; }
  .header p  { font-size:13px; opacity:0.65; }
  .badge { display:inline-block; background:rgba(100,200,255,0.2); border:1px solid rgba(100,200,255,0.4); color:#64c8ff; font-size:11px; padding:3px 10px; border-radius:20px; margin-top:8px; }
  .section-title { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#4a7abf; margin-bottom:14px; padding-bottom:6px; border-bottom:2px solid #e2eaf5; }
  .card { background:#fff; border-radius:10px; padding:22px 26px; margin-bottom:20px; box-shadow:0 2px 12px rgba(0,0,0,0.06); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
  .stat { background:#f0f6ff; border-radius:8px; padding:14px 16px; }
  .stat-label { font-size:11px; color:#6b7fa3; margin-bottom:4px; }
  .stat-value { font-size:20px; font-weight:700; color:#1a3a6b; }
  .stat-unit  { font-size:12px; color:#8a9fc0; }
  .highlight  { background:linear-gradient(135deg,#e8f4ff,#d4ecff); border:1px solid #a8d4f5; }
  .green      { background:linear-gradient(135deg,#e8fff2,#ccf5e0); border:1px solid #7dd4a8; }
  .green .stat-value { color:#1a6b3a; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { background:#f0f6ff; padding:9px 12px; text-align:left; font-weight:600; color:#4a7abf; }
  td { padding:9px 12px; border-bottom:1px solid #eef2f8; }
  tr:last-child td { border-bottom:none; }
  .model-img { width:100%; border-radius:8px; border:1px solid #dde8f5; margin-bottom:6px; }
  .footer { text-align:center; font-size:11px; color:#aab; margin-top:28px; padding-top:16px; border-top:1px solid #e0e8f0; }
  .disclaimer { background:#fff8e8; border:1px solid #ffd980; border-radius:8px; padding:14px 18px; font-size:12px; color:#7a5a00; margin-top:20px; }
</style>
</head><body><div class="page">

  <div class="header">
    <h1>☀️ Solar Installation Report</h1>
    <p>Generated on ${now}</p>
    ${buildingInfo?.dimensions ? `<div class="badge">${buildingInfo.dimensions.width}' × ${buildingInfo.dimensions.length}' • ${buildingInfo.roofType || 'gable'} roof</div>` : ''}
  </div>

  ${imgDataUrl ? `
  <div class="card">
    <div class="section-title">3D Solar Model</div>
    <img class="model-img" src="${imgDataUrl}" alt="3D Solar Model"/>
    <p style="font-size:11px;color:#8a9fc0;text-align:center">Generated 3D model based on uploaded blueprint</p>
  </div>` : ''}

  <div class="card">
    <div class="section-title">Building Information</div>
    <div class="grid3">
      <div class="stat"><div class="stat-label">Roof Type</div><div class="stat-value" style="font-size:16px">${(buildingInfo?.roofType || 'Gable').replace(/\b\w/g,c=>c.toUpperCase())}</div></div>
      ${buildingInfo?.dimensions ? `<div class="stat"><div class="stat-label">Dimensions</div><div class="stat-value" style="font-size:16px">${buildingInfo.dimensions.width}' × ${buildingInfo.dimensions.length}'</div></div>` : ''}
      ${buildingInfo?.pitch ? `<div class="stat"><div class="stat-label">Roof Pitch</div><div class="stat-value" style="font-size:16px">${buildingInfo.pitch}</div></div>` : ''}
    </div>
  </div>

  <div class="card">
    <div class="section-title">Solar System Overview</div>
    <div class="grid3">
      <div class="stat highlight"><div class="stat-label">Solar Panels</div><div class="stat-value">${panelCount}</div><div class="stat-unit">units</div></div>
      <div class="stat highlight"><div class="stat-label">System Size</div><div class="stat-value">${totalCapacity.toFixed(1)}</div><div class="stat-unit">kW</div></div>
      <div class="stat highlight"><div class="stat-label">Annual Output</div><div class="stat-value">${Math.round(annualKwhCalc).toLocaleString('en-IN')}</div><div class="stat-unit">kWh/year</div></div>
      ${skylightCount > 0 ? `<div class="stat"><div class="stat-label">Skylights</div><div class="stat-value">${skylightCount}</div><div class="stat-unit">units</div></div>` : ''}
      ${ventCount > 0 ? `<div class="stat"><div class="stat-label">Roof Vents</div><div class="stat-value">${ventCount}</div><div class="stat-unit">units</div></div>` : ''}
    </div>
  </div>

  <div class="card">
    <div class="section-title">Financial Analysis (PM Surya Ghar Scheme)</div>
    <table>
      <tr><th>Item</th><th>Amount</th></tr>
      <tr><td>Total System Cost (₹60,000/kW)</td><td><strong>₹${systemCost.toLocaleString('en-IN')}</strong></td></tr>
      <tr><td>Government Subsidy</td><td style="color:#1a6b3a"><strong>− ₹${subsidy.toLocaleString('en-IN')}</strong></td></tr>
      <tr style="background:#f0f6ff"><td><strong>Net Cost After Subsidy</strong></td><td><strong>₹${netCost.toLocaleString('en-IN')}</strong></td></tr>
      <tr><td>Annual Electricity Savings (₹7.5/kWh)</td><td style="color:#1a6b3a"><strong>₹${(annualKwhCalc * 7.5).toLocaleString('en-IN', {maximumFractionDigits:0})}/year</strong></td></tr>
      <tr><td>Estimated Savings (Lakh/yr)</td><td><strong>Rs. ${savingsLakhCalc.toFixed(2)} L/yr</strong></td></tr>
      <tr><td>Simple Payback Period</td><td><strong>${payback.toFixed(1)} years</strong></td></tr>
    </table>
  </div>

  <div class="disclaimer">
    <strong>⚠️ Disclaimer:</strong> Estimates based on average Indian solar irradiance. Actual output may vary by location, shading, and panel orientation. Subsidy as per PM Surya Ghar Muft Bijli Yojana — verify current rates with your DISCOM. Consult a certified solar installer before purchase.
  </div>

  <div class="footer">Solar Rooftop Assessment Tool &nbsp;|&nbsp; Report generated ${now}</div>
</div></body></html>`;

      // Open in a new window and trigger print-to-PDF
      const win = window.open('', '_blank', 'width=1000,height=800');
      win.document.write(html);
      win.document.close();
      win.onload = () => { win.focus(); win.print(); };
    } catch (e) {
      console.error('PDF export error:', e);
      alert('PDF export failed: ' + e.message);
    } finally {
      setPdfGenerating(false);
    }
  };

  const annualKwh   = totalCapacity * 1400;
  const savingsLakh = (annualKwh * 7.5) / 100000;

  // Never render if not requested or no data — prevents black screen on load
  if (!show3D) return null;
  if (!blueprintData && !roofPolygon) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {error && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(140,10,10,0.97)', padding: '28px 32px',
          borderRadius: '10px', color: '#fff', maxWidth: '400px', textAlign: 'center'
        }}>
          <h3 style={{ margin: '0 0 10px' }}>3D View Error</h3>
          <p style={{ margin: '0 0 16px', fontSize: '14px', lineHeight: 1.6 }}>{error}</p>
          <button onClick={onClose} style={{
            padding: '10px 28px', background: '#fff', color: '#222',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700'
          }}>Close</button>
        </div>
      )}

      {!error && (
        <div style={{
          position: 'absolute', top: 20, right: 20,
          background: 'linear-gradient(160deg,rgba(8,14,40,0.97),rgba(18,32,65,0.97))',
          padding: '20px 22px', borderRadius: '12px', width: '280px',
          boxShadow: '0 8px 36px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(100,180,255,0.12)',
          color: '#fff', fontFamily: 'inherit'
        }}>
          <h3 style={{
            margin: '0 0 14px', color: '#64c8ff', fontSize: '16px',
            fontWeight: '700', borderBottom: '1px solid rgba(100,200,255,0.15)',
            paddingBottom: '12px', letterSpacing: '0.4px'
          }}>3D Solar Model</h3>

          {buildingInfo && (
            <div style={{
              marginBottom: '12px', padding: '10px 12px',
              background: 'rgba(255,255,255,0.05)', borderRadius: '7px',
              border: '1px solid rgba(255,255,255,0.07)'
            }}>
              <p style={{ margin: '0 0 5px', fontSize: '10px', color: '#64c8ff',
                fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px' }}>Building</p>
              {buildingInfo.type      && <p style={{ margin: '2px 0', fontSize: '12px' }}>Type: <strong>{buildingInfo.type}</strong></p>}
              {buildingInfo.roofType  && <p style={{ margin: '2px 0', fontSize: '12px' }}>Roof: <strong>{buildingInfo.roofType}</strong></p>}
              {buildingInfo.pitch     && <p style={{ margin: '2px 0', fontSize: '12px' }}>Pitch: <strong>{buildingInfo.pitch}</strong></p>}
              {buildingInfo.dimensions && (
                <p style={{ margin: '2px 0', fontSize: '12px' }}>
                  Size: <strong>{buildingInfo.dimensions.width}' x {buildingInfo.dimensions.length}'</strong>
                </p>
              )}
            </div>
          )}

          <div style={{
            padding: '10px 12px', background: 'rgba(100,200,255,0.07)',
            borderRadius: '8px', border: '1px solid rgba(100,200,255,0.12)',
            marginBottom: '14px'
          }}>
            {[
              ['Solar Panels',  panelCount],
              ['System Size',   totalCapacity.toFixed(1) + ' kW'],
              ['Annual Output', Math.round(annualKwh).toLocaleString('en-IN') + ' kWh'],
              ['Est. Savings',  'Rs. ' + savingsLakh.toFixed(2) + ' L/yr'],
              ...(skylightCount > 0 ? [['Skylights', skylightCount + ' units']] : []),
              ...(ventCount     > 0 ? [['Vents',     ventCount     + ' units']] : []),
            ].map(([label, val]) => (
              <div key={label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)'
              }}>
                <span style={{ fontSize: '12px', opacity: 0.65 }}>{label}</span>
                <strong style={{ fontSize: '13px' }}>{val}</strong>
              </div>
            ))}
          </div>

          <button onClick={onClose}
            style={{
              width: '100%', padding: '10px',
              background: 'rgba(100,200,255,0.10)', color: '#fff',
              border: '1px solid rgba(100,200,255,0.25)', borderRadius: '7px',
              cursor: 'pointer', fontSize: '13px', fontWeight: '600',
              marginBottom: '8px',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(100,200,255,0.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(100,200,255,0.10)'}
          >Close 3D View</button>

          <button onClick={exportPDF} disabled={pdfGenerating}
            style={{
              width: '100%', padding: '10px',
              background: pdfGenerating ? 'rgba(60,60,60,0.4)' : 'linear-gradient(135deg,rgba(255,180,50,0.22),rgba(255,140,20,0.32))',
              color: '#fff',
              border: '1px solid rgba(255,180,50,0.45)', borderRadius: '7px',
              cursor: pdfGenerating ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: '600',
              opacity: pdfGenerating ? 0.6 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
            }}
            onMouseEnter={e => { if (!pdfGenerating) e.currentTarget.style.background = 'linear-gradient(135deg,rgba(255,180,50,0.38),rgba(255,140,20,0.48))'; }}
            onMouseLeave={e => { if (!pdfGenerating) e.currentTarget.style.background = 'linear-gradient(135deg,rgba(255,180,50,0.22),rgba(255,140,20,0.32))'; }}
          >
            {pdfGenerating
              ? <><span style={{ width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite',display:'inline-block' }}/> Generating…</>
              : '📄 Export PDF Report'
            }
          </button>

          <p style={{ margin: '10px 0 0', fontSize: '10px', color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
            Drag to rotate  |  Scroll to zoom
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
};

export default EnhancedSolarPanel3D;