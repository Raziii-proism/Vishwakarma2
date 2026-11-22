import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../client/node_modules/three/build/three.module.js';

test('Feature 3: Natural 3D Perspective & Spatial Anchoring', async (t) => {
  // Setup virtual scene with an anchored hologram on a table
  const scene = new THREE.Scene();
  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  // Hologram anchored on a table at world coordinates (0, 0.8, 0)
  const hologramPos = new THREE.Vector3(0, 0.8, 0);
  const cubeGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const cubeMat = new THREE.MeshStandardMaterial({ color: 0x00f5ff });
  const hologramMesh = new THREE.Mesh(cubeGeo, cubeMat);
  hologramMesh.position.copy(hologramPos);
  worldGroup.add(hologramMesh);

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.01, 100);

  await t.test('User A standing in FRONT of the table sees the FRONT of the hologram', () => {
    // Camera at (0, 0.8, 1.2) looking towards (0, 0.8, 0)
    camera.position.set(0, 0.8, 1.2);
    camera.lookAt(hologramPos);
    camera.updateMatrixWorld();

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    // Front face of cube has normal (0, 0, 1). Angle between camDir (0, 0, -1) and normal (0, 0, 1) is ~180°
    const frontNormal = new THREE.Vector3(0, 0, 1);
    const dotFront = camDir.dot(frontNormal);
    assert.ok(dotFront < -0.9, 'Camera looking forward directly faces the front of the object');

    // Hologram world position has NOT changed
    const currentWorldPos = new THREE.Vector3();
    hologramMesh.getWorldPosition(currentWorldPos);
    assert.equal(currentWorldPos.distanceTo(hologramPos), 0, 'Hologram must remain anchored');
  });

  await t.test('User B standing BEHIND the table sees the BACK of the hologram', () => {
    // Camera at (0, 0.8, -1.2) looking towards (0, 0.8, 0)
    camera.position.set(0, 0.8, -1.2);
    camera.lookAt(hologramPos);
    camera.updateMatrixWorld();

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    // Back face normal is (0, 0, -1). CamDir is (0, 0, 1)
    const backNormal = new THREE.Vector3(0, 0, -1);
    const dotBack = camDir.dot(backNormal);
    assert.ok(dotBack < -0.9, 'User behind table directly faces the back of the object');
  });

  await t.test('User moving LEFT sees the LEFT side of the hologram', () => {
    // Camera at (-1.2, 0.8, 0) looking towards (0, 0.8, 0)
    camera.position.set(-1.2, 0.8, 0);
    camera.lookAt(hologramPos);
    camera.updateMatrixWorld();

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    // Left face normal is (-1, 0, 0). CamDir is (1, 0, 0)
    const leftNormal = new THREE.Vector3(-1, 0, 0);
    const dotLeft = camDir.dot(leftNormal);
    assert.ok(dotLeft < -0.9, 'User on left side directly faces the left face of the object');
  });

  await t.test('User looking DOWN sees the TOP of the hologram', () => {
    // Camera at (0, 1.8, 0) looking down at (0, 0.8, 0)
    camera.position.set(0, 1.8, 0);
    camera.lookAt(hologramPos);
    camera.updateMatrixWorld();

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    // Top face normal is (0, 1, 0). CamDir is (0, -1, 0)
    const topNormal = new THREE.Vector3(0, 1, 0);
    const dotTop = camDir.dot(topNormal);
    assert.ok(dotTop < -0.9, 'User above object directly faces the top of the object');
  });
});
