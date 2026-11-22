import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../client/node_modules/three/build/three.module.js';
import { buildScannedMesh, buildHologramMesh } from '../client/src/utils/meshBuilder.js';

test('Feature 2: Object Scanning & 3D Reconstruction', async (t) => {
  await t.test('Reconstructs 3D mesh geometry from a multi-angle point cloud', () => {
    // Generate simulated scan point cloud from an object on a table (e.g. mug/box: 0.15m x 0.2m x 0.15m)
    const mockPoints = [];
    const count = 120;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2;
      const height = ((i % 10) / 10) * 0.15 - 0.075;
      const radius = 0.08 + (Math.random() - 0.5) * 0.01;
      mockPoints.push({
        x: Math.cos(theta) * radius,
        y: height,
        z: Math.sin(theta) * radius,
      });
    }

    const geometry = buildScannedMesh(mockPoints);

    assert.ok(geometry instanceof THREE.BufferGeometry, 'Must output a Three.js BufferGeometry');
    const pos = geometry.getAttribute('position');
    assert.ok(pos, 'Geometry must contain position attribute');
    assert.ok(pos.count > 0, 'Geometry must have vertices');
    assert.ok(geometry.getAttribute('normal'), 'Geometry must compute surface normals');

    // Verify bounding box matches object proportions
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);

    assert.ok(size.x > 0.05 && size.x < 0.35, `X size (${size.x}) within realistic object bounds`);
    assert.ok(size.y > 0.05 && size.y < 0.35, `Y size (${size.y}) within realistic object bounds`);
    assert.ok(size.z > 0.05 && size.z < 0.35, `Z size (${size.z}) within realistic object bounds`);
  });

  await t.test('Serializes and deserializes reconstructed geometry for network transfer', () => {
    const box = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    box.computeVertexNormals();

    const serialized = {
      positions: Array.from(box.getAttribute('position').array),
      normals: Array.from(box.getAttribute('normal').array),
      uvs: Array.from(box.getAttribute('uv').array),
      indices: box.index ? Array.from(box.index.array) : null,
    };

    const hologramData = {
      id: 'test-scan-1',
      type: 'scanned',
      name: 'Coffee Mug',
      geometry: serialized,
      position: { x: 0, y: 0.8, z: -1.0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      hidden: false,
    };

    const mesh = buildHologramMesh(hologramData);

    assert.ok(mesh instanceof THREE.Mesh, 'Rebuilt object must be a Three.js Mesh');
    assert.equal(mesh.geometry.getAttribute('position').count, box.getAttribute('position').count);
    assert.ok(mesh.castShadow, 'Hologram must cast realistic shadows');
    assert.ok(mesh.receiveShadow, 'Hologram must receive shadows');
  });
});
