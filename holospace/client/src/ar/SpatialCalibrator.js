/**
 * SpatialCalibrator — Aligns all devices to the same shared world coordinate system.
 *
 * Strategy:
 *   - Host: Sets world origin by pointing at a surface (hit-test) or QR/marker detection.
 *   - Clients: Align to host's world origin via shared anchor matrix.
 *   - Fallback: Manual QR-code alignment using jsQR library.
 *
 * The world origin is stored as a 4x4 matrix in the worldGroup's local space.
 * All holograms are placed relative to this origin.
 */

import * as THREE from 'three';
import { notify } from '../ui/notifications.js';

export class SpatialCalibrator {
  constructor(renderer, arSession, multiplayer, appState) {
    this.renderer = renderer;
    this.arSession = arSession;
    this.multiplayer = multiplayer;
    this.appState = appState;
    this.isCalibrated = false;
    this._worldOriginMatrix = new THREE.Matrix4();

    // QR detection canvas (for non-WebXR shared calibration)
    this._qrCanvas = document.createElement('canvas');
    this._qrCtx = this._qrCanvas.getContext('2d');
    this._jsQR = null; // loaded lazily
  }

  // ── Set world origin (host/calibration) ────────────────────────────────────
  async setWorldOriginFromHitTest(frame) {
    const hits = this.arSession.getHitTestResults(frame);
    if (hits.length === 0) {
      notify('No surface detected. Point at a flat surface.', 'error');
      return false;
    }
    const pose = this.arSession.getHitPose(hits[0]);
    if (!pose) return false;

    this._applyWorldOrigin(pose.transform.matrix);
    this.isCalibrated = true;

    // Broadcast to peers
    const matrixArray = Array.from(pose.transform.matrix);
    this.multiplayer.setWorldOrigin(matrixArray, (result) => {
      if (result.ok) notify('World origin set — peers aligning...', 'success');
    });

    return true;
  }

  // ── Set world origin at current camera position (non-WebXR) ───────────────
  setWorldOriginFromCamera() {
    const cam = this.renderer.camera;
    const mat = new THREE.Matrix4();
    mat.compose(cam.position, cam.quaternion, new THREE.Vector3(1, 1, 1));
    this._applyWorldOrigin(mat.elements);
    this.isCalibrated = true;

    this.multiplayer.setWorldOrigin(Array.from(mat.elements), (result) => {
      if (result.ok) notify('World origin set at current position', 'success');
    });
  }

  // ── Receive world origin from peer (joining client) ────────────────────────
  receiveWorldOrigin(matrixArray) {
    this._applyWorldOrigin(matrixArray);
    this.isCalibrated = true;
    notify('World origin received — spaces aligned', 'success');
  }

  _applyWorldOrigin(matrixArray) {
    this._worldOriginMatrix.fromArray(matrixArray);
    // Invert to get world-to-local transform for hologram placement
    const invMat = this._worldOriginMatrix.clone().invert();
    this.renderer.worldGroup.matrix.copy(invMat);
    this.renderer.worldGroup.matrix.decompose(
      this.renderer.worldGroup.position,
      this.renderer.worldGroup.quaternion,
      this.renderer.worldGroup.scale
    );
    this.appState.worldOriginMatrix = matrixArray;
    // Show shadow floor at this origin
    if (this.renderer.shadowFloor) {
      this.renderer.shadowFloor.visible = true;
    }
    console.log('[Calibrator] World origin applied');
  }

  // ── Convert hit pose to world-relative position ────────────────────────────
  worldPositionFromHit(hitPose) {
    if (!hitPose) return new THREE.Vector3();
    const worldPos = new THREE.Vector3();
    worldPos.setFromMatrixPosition(new THREE.Matrix4().fromArray(hitPose.transform.matrix));

    // Transform into worldGroup-local space if calibrated
    if (this.isCalibrated) {
      worldPos.applyMatrix4(this._worldOriginMatrix.clone().invert());
    }
    return worldPos;
  }

  // ── Utility: get current reticle position from hit test ───────────────────
  getReticlePosition(frame) {
    if (this.arSession.mode !== 'webxr') return null;
    const hits = this.arSession.getHitTestResults(frame);
    if (hits.length === 0) return null;
    const pose = this.arSession.getHitPose(hits[0]);
    if (!pose) return null;

    const mat = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mat.decompose(pos, quat, scale);

    return { position: pos, quaternion: quat, matrix: mat };
  }

  get calibrated() { return this.isCalibrated; }
}
