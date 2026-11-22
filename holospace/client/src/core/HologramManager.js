/**
 * HologramManager — Manages the lifecycle, rendering, and interaction of holograms.
 * Handles add/remove/update/select/deselect, raycasting, and animation.
 */

import * as THREE from 'three';
import { notify } from '../ui/notifications.js';
import { buildHologramMesh } from '../utils/meshBuilder.js';

export class HologramManager {
  constructor(renderer, appState) {
    this.renderer = renderer;
    this.scene = renderer.scene;
    this.worldGroup = renderer.worldGroup;
    this.appState = appState;
    this.holograms = new Map(); // id -> { data, mesh, anchorPose, hidden }
    this.selectedId = null;

    // Raycaster for touch/click interaction
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // Interaction state
    this._dragTarget = null;
    this._dragPlane = new THREE.Plane();
    this._dragOffset = new THREE.Vector3();
    this._pinchStartDist = 0;
    this._pinchStartScale = 1;

    this._setupInteraction();
  }

  // ── Add a hologram ──────────────────────────────────────────────────────────
  addHologram(data) {
    if (this.holograms.has(data.id)) {
      this.updateHologram(data);
      return;
    }

    const mesh = buildHologramMesh(data);
    if (!mesh) {
      console.warn('[HologramManager] Could not build mesh for', data);
      return;
    }

    // Set transform from data
    mesh.position.set(
      data.position?.x ?? 0,
      data.position?.y ?? 0,
      data.position?.z ?? 0
    );
    if (data.quaternion) {
      mesh.quaternion.set(
        data.quaternion.x, data.quaternion.y,
        data.quaternion.z, data.quaternion.w
      );
    }
    const s = data.scale ?? { x: 1, y: 1, z: 1 };
    mesh.scale.set(s.x, s.y, s.z);
    mesh.visible = data.visible !== false;

    // Shadow support
    mesh.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Store userData for picking
    mesh.userData.hologramId = data.id;

    this.worldGroup.add(mesh);
    this.holograms.set(data.id, { data: { ...data }, mesh });
    this.appState.holograms.set(data.id, data);

    console.log(`[Hologram] Added: ${data.name || data.id}`);
  }

  // ── Update hologram transform ──────────────────────────────────────────────
  updateHologram(update) {
    const entry = this.holograms.get(update.id);
    if (!entry) return;
    Object.assign(entry.data, update);
    const mesh = entry.mesh;

    if (update.position) {
      mesh.position.set(update.position.x, update.position.y, update.position.z);
    }
    if (update.quaternion) {
      mesh.quaternion.set(
        update.quaternion.x, update.quaternion.y,
        update.quaternion.z, update.quaternion.w
      );
    }
    if (update.scale) {
      mesh.scale.set(update.scale.x, update.scale.y, update.scale.z);
    }
    if (update.visible !== undefined) {
      mesh.visible = update.visible;
    }
  }

  // ── Remove hologram ────────────────────────────────────────────────────────
  removeHologram(id) {
    const entry = this.holograms.get(id);
    if (!entry) return;
    this.worldGroup.remove(entry.mesh);
    this.holograms.delete(id);
    this.appState.holograms.delete(id);
    if (this.selectedId === id) this.deselect();
  }

  // ── Selection ──────────────────────────────────────────────────────────────
  select(id) {
    if (this.selectedId === id) return;
    this.deselect();
    this.selectedId = id;
    this.appState.selectedHologramId = id;
    const entry = this.holograms.get(id);
    if (entry) {
      this._addSelectionOutline(entry.mesh);
    }
    document.dispatchEvent(new CustomEvent('hologram:selected', { detail: { id } }));
  }

  deselect() {
    if (this.selectedId) {
      const entry = this.holograms.get(this.selectedId);
      if (entry) this._removeSelectionOutline(entry.mesh);
    }
    this.selectedId = null;
    this.appState.selectedHologramId = null;
    document.dispatchEvent(new CustomEvent('hologram:deselected'));
  }

  _addSelectionOutline(mesh) {
    // Add a subtle glow/outline to selected mesh
    mesh.traverse(child => {
      if (child.isMesh && child.material) {
        child.userData._prevEmissive = child.material.emissive?.getHex?.() ?? 0;
        child.userData._prevEmissiveIntensity = child.material.emissiveIntensity ?? 0;
        if (child.material.emissive) {
          child.material.emissive.set(0x00f5ff);
          child.material.emissiveIntensity = 0.3;
        }
      }
    });
  }

  _removeSelectionOutline(mesh) {
    mesh.traverse(child => {
      if (child.isMesh && child.material) {
        if (child.material.emissive) {
          child.material.emissive.setHex(child.userData._prevEmissive ?? 0);
          child.material.emissiveIntensity = child.userData._prevEmissiveIntensity ?? 0;
        }
      }
    });
  }

  // ── Scale selected ─────────────────────────────────────────────────────────
  scaleSelected(factor) {
    if (!this.selectedId) return null;
    const entry = this.holograms.get(this.selectedId);
    if (!entry) return null;
    entry.mesh.scale.multiplyScalar(factor);
    entry.data.scale = {
      x: entry.mesh.scale.x,
      y: entry.mesh.scale.y,
      z: entry.mesh.scale.z,
    };
    return entry.data;
  }

  setScaleSelected(uniformScale) {
    if (!this.selectedId) return null;
    const entry = this.holograms.get(this.selectedId);
    if (!entry) return null;
    entry.mesh.scale.set(uniformScale, uniformScale, uniformScale);
    entry.data.scale = { x: uniformScale, y: uniformScale, z: uniformScale };
    return entry.data;
  }

  // ── Hide/show original toggle ──────────────────────────────────────────────
  toggleHidden(id) {
    const entry = this.holograms.get(id);
    if (!entry) return;
    entry.data.hidden = !entry.data.hidden;
    // 'hidden' means the original physical object is hidden — the hologram stays
    // We just emit an event; the UI can show visual indicator
    return entry.data.hidden;
  }

  getTransform(id) {
    const entry = this.holograms.get(id);
    if (!entry) return null;
    return {
      position: entry.mesh.position.clone(),
      quaternion: entry.mesh.quaternion.clone(),
      scale: entry.mesh.scale.clone(),
    };
  }

  getCurrentTransformData(id) {
    const entry = this.holograms.get(id);
    if (!entry) return null;
    const m = entry.mesh;
    return {
      id,
      position: { x: m.position.x, y: m.position.y, z: m.position.z },
      quaternion: { x: m.quaternion.x, y: m.quaternion.y, z: m.quaternion.z, w: m.quaternion.w },
      scale: { x: m.scale.x, y: m.scale.y, z: m.scale.z },
    };
  }

  // ── Raycast on canvas touch/click ──────────────────────────────────────────
  _setupInteraction() {
    const canvas = this.renderer.canvas;

    canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e), { passive: false });
    canvas.addEventListener('pointermove', (e) => this._onPointerMove(e), { passive: false });
    canvas.addEventListener('pointerup', (e) => this._onPointerUp(e), { passive: false });
    canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
  }

  _screenToNDC(e) {
    const rect = this.renderer.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  _onPointerDown(e) {
    if (e.pointerType === 'touch' && e.touches?.length > 1) return;
    const ndc = this._screenToNDC(e);
    this.raycaster.setFromCamera(ndc, this.renderer.camera);

    const meshes = [];
    this.holograms.forEach(({ mesh }) => {
      mesh.traverse(child => { if (child.isMesh) meshes.push(child); });
    });

    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const hit = hits[0];
      const hologramId = this._findHologramId(hit.object);
      if (hologramId) {
        this.select(hologramId);
        this._dragTarget = this.holograms.get(hologramId)?.mesh;
        // Create drag plane perpendicular to camera at hit point
        const camDir = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(camDir);
        this._dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point);
        // Offset from hit to object center
        this._dragOffset.copy(this._dragTarget.position).sub(hit.point);
      } else {
        this.deselect();
      }
    } else {
      this.deselect();
    }
  }

  _onPointerMove(e) {
    if (!this._dragTarget) return;
    const ndc = this._screenToNDC(e);
    this.raycaster.setFromCamera(ndc, this.renderer.camera);
    const point = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this._dragPlane, point);
    if (point) {
      this._dragTarget.position.copy(point).add(this._dragOffset);
    }
  }

  _onPointerUp(e) {
    if (this._dragTarget && this.selectedId) {
      // Emit update event for multiplayer sync
      document.dispatchEvent(new CustomEvent('hologram:localMoved', {
        detail: this.getCurrentTransformData(this.selectedId)
      }));
    }
    this._dragTarget = null;
  }

  _findHologramId(mesh) {
    // Walk up the ancestor chain to find hologramId
    let obj = mesh;
    while (obj) {
      if (obj.userData.hologramId) return obj.userData.hologramId;
      obj = obj.parent;
    }
    return null;
  }

  // ── Per-frame update ───────────────────────────────────────────────────────
  update(frame, referenceSpace) {
    // Per-frame animations (holograms pulsing, etc.)
    const t = performance.now() / 1000;
    this.holograms.forEach(({ data, mesh }) => {
      // Gentle float animation for placed holograms
      if (data.type === 'placed' && mesh.userData.floatOrigin !== undefined) {
        mesh.position.y = mesh.userData.floatOrigin + Math.sin(t * 1.5) * 0.005;
      }
    });
  }

  getAllData() {
    const result = [];
    this.holograms.forEach(({ data }) => result.push(data));
    return result;
  }
}
