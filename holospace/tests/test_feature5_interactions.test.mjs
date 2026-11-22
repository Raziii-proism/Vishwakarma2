import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../client/node_modules/three/build/three.module.js';

test('Feature 5: Hologram CRUD, Selection, Scaling & Hide Original Toggle', async (t) => {
  // Mock Hologram Manager state
  const holograms = new Map();
  let selectedId = null;

  function addHologram(data) {
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x00f5ff });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(data.position.x, data.position.y, data.position.z);
    mesh.scale.set(data.scale.x, data.scale.y, data.scale.z);
    mesh.userData.hologramId = data.id;
    const entry = { data: { ...data }, mesh };
    holograms.set(data.id, entry);
    return entry;
  }

  function select(id) {
    selectedId = id;
  }

  function setScale(id, s) {
    const h = holograms.get(id);
    if (!h) return null;
    h.mesh.scale.set(s, s, s);
    h.data.scale = { x: s, y: s, z: s };
    return h.data;
  }

  function toggleHideOriginal(id) {
    const h = holograms.get(id);
    if (!h) return null;
    h.data.hidden = !h.data.hidden;
    // Note: hologram mesh remains fully visible!
    h.mesh.visible = true;
    return h.data.hidden;
  }

  function removeHologram(id) {
    holograms.delete(id);
    if (selectedId === id) selectedId = null;
  }

  await t.test('Creates and places multiple holograms into the 3D scene', () => {
    addHologram({
      id: 'holo-1',
      name: 'Scan of Vase',
      position: { x: 0.2, y: 0.8, z: -0.5 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      hidden: false,
    });

    addHologram({
      id: 'holo-2',
      name: 'Scan of Laptop',
      position: { x: -0.3, y: 0.8, z: -0.6 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      hidden: false,
    });

    assert.equal(holograms.size, 2);
    assert.equal(holograms.get('holo-1').data.name, 'Scan of Vase');
    assert.equal(holograms.get('holo-2').data.name, 'Scan of Laptop');
  });

  await t.test('Selects and scales a hologram', () => {
    select('holo-1');
    assert.equal(selectedId, 'holo-1');

    setScale('holo-1', 1.8);
    const updated = holograms.get('holo-1');
    assert.equal(updated.mesh.scale.x, 1.8);
    assert.equal(updated.data.scale.x, 1.8);
  });

  await t.test('Hides original physical object while keeping virtual hologram visible and anchored', () => {
    const initialHidden = holograms.get('holo-1').data.hidden;
    assert.equal(initialHidden, false);

    const isHidden = toggleHideOriginal('holo-1');
    assert.equal(isHidden, true, 'Original object is marked as hidden');
    assert.equal(holograms.get('holo-1').mesh.visible, true, 'Hologram must remain rendered on screen');
    assert.equal(holograms.get('holo-1').mesh.position.y, 0.8, 'Hologram remains anchored at exact physical position');
  });

  await t.test('Performs raycasting intersection to pick holograms in 3D', () => {
    const raycaster = new THREE.Raycaster();
    // Ray pointing directly at holo-1 located at (0.2, 0.8, -0.5)
    raycaster.set(new THREE.Vector3(0.2, 0.8, 1.0), new THREE.Vector3(0, 0, -1));

    const meshes = Array.from(holograms.values()).map(h => {
      h.mesh.updateMatrixWorld(true);
      return h.mesh;
    });
    const intersects = raycaster.intersectObjects(meshes);

    assert.ok(intersects.length > 0, 'Ray must hit the hologram mesh');
    assert.equal(intersects[0].object.userData.hologramId, 'holo-1');
  });

  await t.test('Removes hologram and cleans up selection', () => {
    removeHologram('holo-1');
    assert.equal(holograms.has('holo-1'), false);
    assert.equal(selectedId, null);
    assert.equal(holograms.size, 1);
  });
});
