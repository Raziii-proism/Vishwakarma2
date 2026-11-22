/**
 * ARSession — Manages camera passthrough, WebXR, and device orientation tracking.
 * Provides a unified interface regardless of platform capability.
 *
 * Mode hierarchy:
 *   1. webxr   — Full WebXR immersive-ar (Android Chrome / ARCore)
 *   2. camera  — getUserMedia rear camera + DeviceOrientation SLAM
 *   3. orientation — DeviceOrientation only (no camera)
 */

import * as THREE from 'three';

export class ARSession {
  constructor(renderer, caps) {
    this.renderer = renderer;
    this.caps = caps;
    this.mode = caps.mode;

    // Camera feed element (for non-WebXR)
    this.videoEl = document.getElementById('camera-feed');

    // Tracking state
    this._pose = {
      position: { x: 0, y: 1.6, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    };

    // WebXR state
    this._xrSession = null;
    this._referenceSpace = null;
    this._hitTestSource = null;
    this._lightProbe = null;
    this._frame = null;

    // Orientation tracking (non-XR)
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._quaternion = new THREE.Quaternion();
    this._alpha0 = null; // initial compass bearing

    // Animation loop
    this._animationCallback = null;
    this._running = false;
  }

  async init() {
    if (this.mode === 'webxr') {
      await this._initWebXR();
    } else if (this.mode === 'camera') {
      await this._initCamera();
      this._initOrientationTracking();
    } else {
      this._initOrientationTracking();
    }
  }

  // ── WebXR path ──────────────────────────────────────────────────────────────
  async _initWebXR() {
    this.renderer.xr.enabled = true;

    // The XR session is started when user taps "Enter AR"
    // We pre-configure but don't start until user initiates
    const sessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['anchors', 'light-estimation', 'dom-overlay', 'depth-sensing'],
      domOverlay: { root: document.getElementById('hud') },
    };

    document.addEventListener('ar:start', async () => {
      try {
        const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
        this._xrSession = session;
        this.renderer.xr.setSession(session);

        // Reference space
        this._referenceSpace = await session.requestReferenceSpace('local-floor').catch(
          () => session.requestReferenceSpace('local')
        );

        // Hit test source
        const viewerSpace = await session.requestReferenceSpace('viewer');
        this._hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

        // Light estimation
        if (session.requestLightProbe) {
          try {
            this._lightProbe = await session.requestLightProbe();
          } catch (_) {}
        }

        session.addEventListener('end', () => {
          this._hitTestSource = null;
          this._xrSession = null;
        });

        // Hide the camera video element in WebXR (XR handles passthrough)
        this.videoEl.style.display = 'none';

        console.log('[ARSession] WebXR immersive-ar started');
      } catch (err) {
        console.error('[ARSession] Failed to start WebXR:', err);
        // Fall back to camera mode
        this.mode = 'camera';
        await this._initCamera();
        this._initOrientationTracking();
      }
    });
  }

  // ── Camera passthrough (non-WebXR) ──────────────────────────────────────────
  async _initCamera() {
    try {
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoEl.srcObject = stream;
      await new Promise(resolve => { this.videoEl.onloadedmetadata = resolve; });
      this.videoEl.style.display = 'block';
      this._stream = stream;
      console.log('[ARSession] Camera stream started');
    } catch (err) {
      console.error('[ARSession] Camera access denied:', err);
      this.mode = 'orientation';
    }
  }

  // ── Device orientation (non-WebXR pose approximation) ──────────────────────
  _initOrientationTracking() {
    const handler = (e) => {
      // e.alpha: compass bearing (0–360), e.beta: front-back tilt, e.gamma: left-right tilt
      if (e.alpha === null) return;

      // Normalize alpha to a fixed world bearing
      if (this._alpha0 === null) this._alpha0 = e.alpha;

      const alpha = THREE.MathUtils.degToRad(-(e.alpha - this._alpha0));
      const beta  = THREE.MathUtils.degToRad(e.beta  ?? 0);
      const gamma = THREE.MathUtils.degToRad(e.gamma ?? 0);

      // Apply device orientation to Euler (landscape mode: swap axes)
      const isLandscape = window.innerWidth > window.innerHeight;
      if (isLandscape) {
        this._euler.set(beta, alpha, -gamma, 'YXZ');
      } else {
        this._euler.set(beta - Math.PI / 2, alpha, -gamma, 'YXZ');
      }

      this._quaternion.setFromEuler(this._euler);
      this.renderer.camera.quaternion.copy(this._quaternion);
      this._pose.quaternion = {
        x: this._quaternion.x, y: this._quaternion.y,
        z: this._quaternion.z, w: this._quaternion.w,
      };
    };

    // iOS 13+ requires permission
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      document.addEventListener('ar:start', async () => {
        try {
          const perm = await DeviceOrientationEvent.requestPermission();
          if (perm === 'granted') window.addEventListener('deviceorientation', handler);
        } catch (_) {}
      }, { once: true });
    } else {
      window.addEventListener('deviceorientation', handler);
    }

    // Motion for position estimation (complementary filter)
    if ('DeviceMotionEvent' in window) {
      let vx = 0, vy = 0, vz = 0;
      const lastT = { v: 0 };
      window.addEventListener('devicemotion', (e) => {
        if (!e.accelerationIncludingGravity) return;
        const now = performance.now();
        const dt = Math.min((now - lastT.v) / 1000, 0.05);
        lastT.v = now;

        const ax = e.accelerationIncludingGravity.x ?? 0;
        const ay = e.accelerationIncludingGravity.y ?? 0;
        const az = e.accelerationIncludingGravity.z ?? 0;

        // Simple integrate (high-drift, complementary approach)
        // We use this only for relative movement, anchoring corrects drift
        vx += ax * dt * 0.3;
        vy += ay * dt * 0.3;
        vz += az * dt * 0.3;

        // Decay velocity (simulate friction / dampening)
        vx *= 0.9; vy *= 0.9; vz *= 0.9;

        // Transform from device space to world space
        const delta = new THREE.Vector3(vx * dt, vy * dt, vz * dt);
        delta.applyQuaternion(this._quaternion);

        this.renderer.camera.position.add(delta);
        this._pose.position = {
          x: this.renderer.camera.position.x,
          y: this.renderer.camera.position.y,
          z: this.renderer.camera.position.z,
        };
      });
    }
  }

  // ── Render loop ─────────────────────────────────────────────────────────────
  startRenderLoop(callback) {
    this._animationCallback = callback;
    this._running = true;

    if (this.mode === 'webxr') {
      // XR handles the loop via setAnimationLoop
      this.renderer.threeRenderer.setAnimationLoop((timestamp, frame) => {
        if (!this._running) return;
        this._frame = frame;

        if (frame && this._referenceSpace) {
          // Update camera from XR pose
          const pose = frame.getViewerPose(this._referenceSpace);
          if (pose) {
            const view = pose.views[0];
            const { position: p, orientation: q } = view.transform;
            this._pose.position = { x: p.x, y: p.y, z: p.z };
            this._pose.quaternion = { x: q.x, y: q.y, z: q.z, w: q.w };
          }
          // Light estimation
          if (this._lightProbe) {
            const estimation = frame.getLightEstimate(this._lightProbe);
            this.renderer.updateLighting(estimation);
          }
        }

        callback(frame, this._referenceSpace);
      });
    } else {
      // Manual rAF loop for camera/orientation modes
      const loop = () => {
        if (!this._running) return;
        requestAnimationFrame(loop);
        callback(null, null);
        this.renderer.renderManual();
      };
      requestAnimationFrame(loop);
    }
  }

  stopRenderLoop() {
    this._running = false;
    if (this.mode === 'webxr') {
      this.renderer.threeRenderer.setAnimationLoop(null);
    }
  }

  // ── Hit testing (surface detection) ─────────────────────────────────────────
  getHitTestResults(frame) {
    if (this.mode !== 'webxr' || !frame || !this._hitTestSource) return [];
    return frame.getHitTestResults(this._hitTestSource);
  }

  getHitPose(hitResult) {
    if (!hitResult || !this._referenceSpace) return null;
    return hitResult.getPose(this._referenceSpace);
  }

  createAnchor(hitResult, frame) {
    if (!hitResult || !frame) return null;
    return hitResult.createAnchor();
  }

  // ── Current pose ─────────────────────────────────────────────────────────────
  getCurrentPose() { return { ...this._pose }; }

  get referenceSpace() { return this._referenceSpace; }
  get xrFrame() { return this._frame; }
  get xrSession() { return this._xrSession; }
}
