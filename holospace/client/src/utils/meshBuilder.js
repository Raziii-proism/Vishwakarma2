/**
 * meshBuilder — Utilities for constructing Three.js meshes from scan data.
 *
 * buildHologramMesh: Creates a mesh from stored hologram data (deserialized geometry or primitive).
 * buildScannedMesh:  Reconstructs a mesh from a normalized point cloud using
 *                    a simplified convex hull approach.
 */

import * as THREE from 'three';

// ── Build mesh from hologram data ─────────────────────────────────────────────
export function buildHologramMesh(data) {
  if (data.type === 'scanned' && data.geometry) {
    return buildFromSerializedGeometry(data.geometry, data.texture);
  }
  if (data.type === 'primitive') {
    return buildPrimitive(data.shape || 'box', data.color || '#00f5ff');
  }
  // Default: glowing holographic sphere
  return buildPrimitive('sphere', data.color || '#00f5ff');
}

// ── Deserialize stored geometry ───────────────────────────────────────────────
function buildFromSerializedGeometry(geoData, textureDataUrl) {
  const geometry = new THREE.BufferGeometry();

  if (geoData.positions) {
    geometry.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(geoData.positions), 3));
  }
  if (geoData.normals) {
    geometry.setAttribute('normal',
      new THREE.BufferAttribute(new Float32Array(geoData.normals), 3));
  }
  if (geoData.uvs) {
    geometry.setAttribute('uv',
      new THREE.BufferAttribute(new Float32Array(geoData.uvs), 2));
  }
  if (geoData.indices) {
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(geoData.indices), 1));
  }

  if (!geoData.normals) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // Build material
  let material;
  if (textureDataUrl) {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(textureDataUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    material = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
  } else {
    material = holographicMaterial();
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ── Build primitive hologram ─────────────────────────────────────────────────
function buildPrimitive(shape, color) {
  let geo;
  switch (shape) {
    case 'sphere':  geo = new THREE.SphereGeometry(0.1, 32, 24); break;
    case 'box':     geo = new THREE.BoxGeometry(0.15, 0.15, 0.15); break;
    case 'cylinder':geo = new THREE.CylinderGeometry(0.07, 0.07, 0.15, 32); break;
    default:        geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  }
  const mat = holographicMaterial(color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.userData.floatOrigin = 0; // mark for float animation
  return mesh;
}

// ── Holographic wireframe material ────────────────────────────────────────────
function holographicMaterial(color = '#00f5ff') {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.2,
    roughness: 0.1,
    metalness: 0.6,
    transparent: true,
    opacity: 0.85,
    wireframe: false,
    side: THREE.DoubleSide,
  });
}

// ── Build scanned mesh from point cloud ───────────────────────────────────────
export function buildScannedMesh(normalizedPoints) {
  // We use a simplified reconstruction:
  // 1. Compute bounding box
  // 2. Create a rounded convex hull using spherical sampling
  // 3. Apply the point cloud as vertex positions

  const pts = normalizedPoints;
  if (pts.length === 0) return new THREE.SphereGeometry(0.1, 16, 12);

  // Compute AABB
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  pts.forEach(p => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  });

  const sx = maxX - minX || 0.1;
  const sy = maxY - minY || 0.1;
  const sz = maxZ - minZ || 0.1;

  // Build a geometry that approximates the scan shape
  // Strategy: subdivided box scaled to object bounding box, then
  // displace vertices toward nearest point cloud sample
  const resolution = 8;
  const baseGeo = new THREE.BoxGeometry(sx, sy, sz, resolution, resolution, resolution);
  const posAttr = baseGeo.getAttribute('position');

  // Displace each vertex toward nearest point cloud sample
  const ptVecs = pts.slice(0, 500).map(p => new THREE.Vector3(p.x, p.y, p.z));
  const tempV = new THREE.Vector3();

  for (let i = 0; i < posAttr.count; i++) {
    tempV.fromBufferAttribute(posAttr, i);

    let nearestDist = Infinity;
    let nearestPt = null;
    for (const pv of ptVecs) {
      const d = tempV.distanceToSquared(pv);
      if (d < nearestDist) {
        nearestDist = d;
        nearestPt = pv;
      }
    }

    if (nearestPt) {
      // Blend vertex toward nearest point
      const blend = 0.3;
      tempV.lerp(nearestPt, blend);
      posAttr.setXYZ(i, tempV.x, tempV.y, tempV.z);
    }
  }

  posAttr.needsUpdate = true;
  baseGeo.computeVertexNormals();

  return baseGeo;
}
