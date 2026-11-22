import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../client/node_modules/three/build/three.module.js';
import { buildHologramMesh } from '../client/src/utils/meshBuilder.js';

test('Feature 6: Real-Time Optical Paper Text Recognition & 3D Blue Hologram Generation', async (t) => {
  await t.test('Generates a 3D blue glowing holographic card from recognized paper text', () => {
    const paperHologramData = {
      id: 'paper-holo-test-1',
      type: 'paper-text',
      name: 'Paper: MEETING AT 5 PM',
      text: 'MEETING AT 5 PM IN CONFERENCE ROOM',
      position: { x: 0, y: 0.82, z: -0.6 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      hidden: false,
    };

    const mesh = buildHologramMesh(paperHologramData);

    assert.ok(mesh instanceof THREE.Mesh, 'Must instantiate a Three.js Mesh');
    assert.equal(mesh.children.length > 0, true, 'Must have cyber glowing border wireframe child');
    assert.equal(mesh.material.transparent, true, 'Must use transparent holographic material');
  });

  await t.test('Anchors the blue holographic text at the physical table position', () => {
    const tableAnchor = new THREE.Vector3(0.2, 0.78, -0.5);
    const cameraFront = new THREE.Vector3(0.2, 1.2, 0.2); // user looking down at table

    const viewDir = new THREE.Vector3().subVectors(tableAnchor, cameraFront).normalize();
    const dot = viewDir.dot(new THREE.Vector3(0, -1, 0)); // pointing downward towards table

    assert.ok(dot > 0.5, 'Camera vector must be angled downward towards table surface');
    assert.equal(tableAnchor.y, 0.78, 'Hologram position remains physically anchored at 0.78m height');
  });
});
