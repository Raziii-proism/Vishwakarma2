/**
 * HOLOSPACE — Main Entry Point
 * Orchestrates all subsystems: AR tracking, 3D scanning, multiplayer, rendering.
 */

import { ARSession } from './ar/ARSession.js';
import { HolospaceRenderer } from './core/HolospaceRenderer.js';
import { ObjectScanner } from './scanning/ObjectScanner.js';
import { MultiplayerManager } from './multiplayer/MultiplayerManager.js';
import { HologramManager } from './core/HologramManager.js';
import { UIController } from './ui/UIController.js';
import { notify, setLoadingStatus, setLoadingProgress, hideLoadingScreen } from './ui/notifications.js';
import { SpatialCalibrator } from './ar/SpatialCalibrator.js';

// ─── Global App State ─────────────────────────────────────────────────────────
export const AppState = {
  roomId: null,
  peerId: null,
  peerInfo: null,
  peers: new Map(),
  holograms: new Map(),
  selectedHologramId: null,
  isScanning: false,
  arMode: 'camera', // 'webxr' | 'camera' | 'orientation'
  worldOriginMatrix: null,
  showPeers3D: true,
  showShadows: true,
};

// ─── Boot Sequence ─────────────────────────────────────────────────────────────
async function boot() {
  try {
    setLoadingStatus('Checking browser capabilities...');
    setLoadingProgress(10);

    // Detect AR capabilities
    const caps = await detectCapabilities();
    AppState.arMode = caps.mode;
    setLoadingProgress(25);

    setLoadingStatus('Initializing renderer...');
    const renderer = new HolospaceRenderer(document.getElementById('holospace-canvas'));
    await renderer.init();
    setLoadingProgress(40);

    setLoadingStatus('Starting camera...');
    const arSession = new ARSession(renderer, caps);
    await arSession.init();
    setLoadingProgress(60);

    setLoadingStatus('Loading hologram engine...');
    const hologramManager = new HologramManager(renderer, AppState);
    setLoadingProgress(70);

    setLoadingStatus('Connecting to HOLOSPACE network...');
    const multiplayer = new MultiplayerManager(AppState, hologramManager, renderer);
    setLoadingProgress(80);

    setLoadingStatus('Initializing scanner...');
    const scanner = new ObjectScanner(renderer, arSession, hologramManager, multiplayer, AppState);
    setLoadingProgress(88);

    setLoadingStatus('Setting up spatial calibration...');
    const calibrator = new SpatialCalibrator(renderer, arSession, multiplayer, AppState);
    setLoadingProgress(93);

    setLoadingStatus('Building UI...');
    const ui = new UIController({
      arSession, renderer, hologramManager, multiplayer, scanner, calibrator, AppState
    });
    setLoadingProgress(100);

    // Show fallback banner if not WebXR
    if (caps.mode !== 'webxr') {
      document.getElementById('fallback-banner').style.display = 'flex';
      document.getElementById('fallback-message').textContent =
        caps.mode === 'camera'
          ? 'Camera + orientation tracking mode (WebXR unavailable on this device)'
          : 'Orientation-only mode (camera access denied)';
    }

    // Start render loop
    arSession.startRenderLoop((frame, referenceSpace) => {
      hologramManager.update(frame, referenceSpace);
      multiplayer.updatePoseBroadcast(arSession.getCurrentPose());
      renderer.render(frame);
    });

    hideLoadingScreen();
    document.getElementById('app').style.display = 'block';

    notify(`HOLOSPACE ready — ${caps.mode.toUpperCase()} mode`, 'info');
    console.log('[HOLOSPACE] Boot complete. Mode:', caps.mode);

  } catch (err) {
    console.error('[HOLOSPACE] Boot failed:', err);
    setLoadingStatus(`Error: ${err.message}`);
  }
}

// ─── Capability Detection ─────────────────────────────────────────────────────
async function detectCapabilities() {
  const caps = {
    webxr: false,
    camera: false,
    deviceOrientation: 'DeviceOrientationEvent' in window,
    deviceMotion: 'DeviceMotionEvent' in window,
    mode: 'orientation',
  };

  // Check WebXR immersive-ar
  if ('xr' in navigator) {
    try {
      caps.webxr = await navigator.xr.isSessionSupported('immersive-ar');
    } catch (e) {
      caps.webxr = false;
    }
  }

  // Check camera
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const test = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      test.getTracks().forEach(t => t.stop());
      caps.camera = true;
    } catch (e) {
      caps.camera = false;
    }
  }

  // Determine best mode
  if (caps.webxr) {
    caps.mode = 'webxr';
  } else if (caps.camera) {
    caps.mode = 'camera';
  } else {
    caps.mode = 'orientation';
  }

  console.log('[Capabilities]', caps);
  return caps;
}

// ─── Handle deep-link room codes ──────────────────────────────────────────────
function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room') || params.get('r');
  if (roomCode) {
    // Auto-fill the join input after UI loads
    window.pendingRoomCode = roomCode.toUpperCase();
  }
}

parseUrlParams();
boot();
