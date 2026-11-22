/**
 * HolospaceRenderer — Three.js scene and WebXR renderer setup.
 * Manages scene, camera, lighting, and both WebXR and fallback rendering paths.
 */

import * as THREE from 'three';

export class HolospaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.peerAvatars = new Map(); // peerId -> THREE.Object3D
  }

  async init() {
    // ── Scene ────────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Camera ───────────────────────────────────────────────────────────────
    // FOV matches a typical rear camera lens (~60-70°)
    this.camera = new THREE.PerspectiveCamera(70, this.width / this.height, 0.01, 100);
    this.camera.position.set(0, 1.6, 0); // Default eye height

    // ── Renderer ─────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,         // transparent background (camera shows through)
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0); // transparent

    // ── Lighting ─────────────────────────────────────────────────────────────
    this.setupLighting();

    // ── World group (anchored to world origin) ────────────────────────────────
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);

    // ── Invisible floor for shadow receiving ─────────────────────────────────
    const floorGeo = new THREE.PlaneGeometry(10, 10);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    this.shadowFloor = new THREE.Mesh(floorGeo, floorMat);
    this.shadowFloor.rotation.x = -Math.PI / 2;
    this.shadowFloor.receiveShadow = true;
    this.shadowFloor.visible = false; // shown after calibration
    this.worldGroup.add(this.shadowFloor);

    // ── Resize observer ───────────────────────────────────────────────────────
    window.addEventListener('resize', () => this.onResize());
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', () => this.onResize());
    }

    console.log('[Renderer] Three.js scene initialized');
  }

  setupLighting() {
    // Ambient — soft fill light
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    this.ambientLight = ambient;

    // Main directional light — casts shadows
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(2, 4, 2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 20;
    dirLight.shadow.camera.left = -5;
    dirLight.shadow.camera.right = 5;
    dirLight.shadow.camera.top = 5;
    dirLight.shadow.camera.bottom = -5;
    dirLight.shadow.bias = -0.001;
    this.scene.add(dirLight);
    this.mainLight = dirLight;

    // Hemisphere light — sky/ground gradient
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x222200, 0.4);
    this.scene.add(hemi);
  }

  updateLighting(estimation) {
    if (!estimation) return;
    if (estimation.sphericalHarmonicsCoefficients) {
      // WebXR light estimation
      this.ambientLight.intensity = estimation.primaryLightIntensity?.value ?? 0.6;
    }
  }

  setShadowsEnabled(enabled) {
    this.renderer.shadowMap.enabled = enabled;
    this.shadowFloor.visible = enabled;
  }

  // ── WebXR render (called by XR animation loop) ──────────────────────────────
  render(frame) {
    this.renderer.render(this.scene, this.camera);
  }

  // ── Non-XR manual render ─────────────────────────────────────────────────────
  renderManual() {
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }

  // ── Peer avatar management ────────────────────────────────────────────────────
  addPeerAvatar(peerId, color = '#00f5ff') {
    if (this.peerAvatars.has(peerId)) return;
    const group = new THREE.Group();

    // Simple avatar: colored sphere + name ring
    const geo = new THREE.SphereGeometry(0.05, 12, 8);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 });
    const sphere = new THREE.Mesh(geo, mat);
    group.add(sphere);

    // Direction cone
    const coneGeo = new THREE.ConeGeometry(0.02, 0.08, 6);
    const coneMat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.7 });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.rotation.x = Math.PI / 2;
    cone.position.z = -0.07;
    group.add(cone);

    this.worldGroup.add(group);
    this.peerAvatars.set(peerId, group);
  }

  updatePeerAvatar(peerId, pose) {
    const avatar = this.peerAvatars.get(peerId);
    if (!avatar || !pose) return;
    avatar.position.set(pose.position.x, pose.position.y, pose.position.z);
    if (pose.quaternion) {
      avatar.quaternion.set(
        pose.quaternion.x, pose.quaternion.y,
        pose.quaternion.z, pose.quaternion.w
      );
    }
  }

  removePeerAvatar(peerId) {
    const avatar = this.peerAvatars.get(peerId);
    if (avatar) {
      this.worldGroup.remove(avatar);
      this.peerAvatars.delete(peerId);
    }
  }

  get xr() { return this.renderer.xr; }
  get threeRenderer() { return this.renderer; }
}
