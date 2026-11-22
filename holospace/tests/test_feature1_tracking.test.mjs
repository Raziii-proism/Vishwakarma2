import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../client/node_modules/three/build/three.module.js';

test('Feature 1: Camera Pose Tracking & Coordinate Transformations', async (t) => {
  await t.test('Transforms Euler angles into valid Quaternions for landscape phone orientation', () => {
    // Phone held horizontally (landscape) close to eyes
    const alpha = THREE.MathUtils.degToRad(45); // heading 45 deg
    const beta = THREE.MathUtils.degToRad(15);  // slight tilt
    const gamma = THREE.MathUtils.degToRad(0);

    const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ');
    const quat = new THREE.Quaternion().setFromEuler(euler);

    assert.ok(Math.abs(quat.length() - 1.0) < 1e-4, 'Quaternion must be normalized');

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    assert.ok(forward.length() > 0.99 && forward.length() < 1.01, 'Forward vector must have unit length');
  });

  await t.test('Simulates device motion integration with complementary velocity dampening', () => {
    const position = new THREE.Vector3(0, 1.6, 0); // eye height
    let vx = 0, vy = 0, vz = 0;
    const dt = 0.016; // 60 FPS frame

    // Simulate forward acceleration
    const ax = 0, ay = 0, az = -0.5; // moving forward
    vx += ax * dt * 0.3;
    vy += ay * dt * 0.3;
    vz += az * dt * 0.3;

    // Apply friction dampening
    vx *= 0.9; vy *= 0.9; vz *= 0.9;

    const delta = new THREE.Vector3(vx * dt, vy * dt, vz * dt);
    position.add(delta);

    assert.ok(position.z < 0, 'Camera should have translated along -Z');
    assert.equal(position.y, 1.6, 'Camera height should remain steady');
  });
});
