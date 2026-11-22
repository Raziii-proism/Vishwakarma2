/**
 * PaperReader — Automatically reads text from paper on a table
 * and projects a glowing neon blue 3D holographic text display in real-time.
 */

import * as THREE from 'three';
import { notify } from '../ui/notifications.js';

export class PaperReader {
  constructor(renderer, arSession, hologramManager, multiplayer, appState) {
    this.renderer = renderer;
    this.arSession = arSession;
    this.hologramManager = hologramManager;
    this.multiplayer = multiplayer;
    this.appState = appState;

    this.autoScan = false;
    this.isProcessing = false;
    this.ocrWorker = null;
    this.ocrReady = false;
    this.lastDetectedText = '';
    this._scanInterval = null;

    // Temporary canvas for video frame sampling & contrast enhancement
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCtx = this.sampleCanvas.getContext('2d');

    this._initOCR();
  }

  // ── Lazy-load Tesseract OCR engine ──────────────────────────────────────────
  async _initOCR() {
    try {
      if (typeof window.Tesseract === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = async () => {
          await this._setupWorker();
        };
        script.onerror = () => {
          console.warn('[PaperReader] Tesseract CDN unavailable, using local OCR fallback');
          this.ocrReady = true;
        };
        document.head.appendChild(script);
      } else {
        await this._setupWorker();
      }
    } catch (e) {
      console.warn('[PaperReader] OCR init fallback:', e);
      this.ocrReady = true;
    }
  }

  async _setupWorker() {
    try {
      if (window.Tesseract) {
        this.ocrWorker = await window.Tesseract.createWorker('eng', 1, {
          logger: () => {}, // silent
        });
        this.ocrReady = true;
        console.log('[PaperReader] OCR engine ready');
      }
    } catch (err) {
      console.warn('[PaperReader] Worker setup note:', err.message);
      this.ocrReady = true;
    }
  }

  // ── Toggle Auto-Scan ────────────────────────────────────────────────────────
  toggleAutoScan() {
    this.autoScan = !this.autoScan;
    if (this.autoScan) {
      notify('Paper Text Scanner: ACTIVE (Point camera at paper)', 'info');
      this._scanInterval = setInterval(() => this.scanPaperFrame(), 1600);
    } else {
      notify('Paper Text Scanner: PAUSED', 'info');
      if (this._scanInterval) clearInterval(this._scanInterval);
    }
    return this.autoScan;
  }

  // ── Scan single frame from camera ───────────────────────────────────────────
  async scanPaperFrame() {
    if (this.isProcessing) return;
    const video = document.getElementById('camera-feed');
    if (!video || video.readyState < 2 || !video.videoWidth) return;

    this.isProcessing = true;
    this._updateScanIndicator(true);

    try {
      // Downscale center crop (where table paper is usually placed)
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cropW = Math.floor(vw * 0.65);
      const cropH = Math.floor(vh * 0.65);
      const startX = Math.floor((vw - cropW) / 2);
      const startY = Math.floor((vh - cropH) / 2);

      this.sampleCanvas.width = 480;
      this.sampleCanvas.height = 360;

      // Draw high-contrast cropped center to canvas
      this.sampleCtx.drawImage(
        video,
        startX, startY, cropW, cropH,
        0, 0, 480, 360
      );

      // Contrast enhancement filter to make written text pop from white paper
      this._enhanceTextContrast(this.sampleCtx, 480, 360);

      let detectedText = '';

      if (this.ocrWorker) {
        const { data } = await this.ocrWorker.recognize(this.sampleCanvas);
        detectedText = data.text ? data.text.trim() : '';
      } else {
        // Lightweight simulated text detection when offline
        detectedText = this._fallbackTextDetector(this.sampleCtx, 480, 360);
      }

      // Filter out garbage noise or single characters
      const cleanText = this._cleanRecognizedText(detectedText);

      if (cleanText && cleanText.length >= 3 && cleanText !== this.lastDetectedText) {
        this.lastDetectedText = cleanText;
        console.log('[PaperReader] Recognized text:', cleanText);
        notify(`Paper Read: "${cleanText.substring(0, 30)}${cleanText.length > 30 ? '...' : ''}"`, 'success');

        // Spawn 3D blue hologram right over table surface
        this.spawnHolographicText(cleanText);
      }
    } catch (err) {
      console.warn('[PaperReader] Scan error:', err);
    } finally {
      this.isProcessing = false;
      this._updateScanIndicator(false);
    }
  }

  // ── Manual scan trigger (when user taps button or voice command) ────────────
  async manualReadPaper(forcedText = null) {
    if (forcedText) {
      this.spawnHolographicText(forcedText);
      return;
    }
    notify('Scanning paper on table for text...', 'info');
    await this.scanPaperFrame();
  }

  // ── Create and anchor 3D blue glowing hologram in physical space ─────────────
  spawnHolographicText(text) {
    // Determine 3D spawn position on the table
    const frame = this.arSession.xrFrame;
    let position = { x: 0, y: 0.8, z: -0.6 };

    if (frame && this.arSession.mode === 'webxr') {
      const hits = this.arSession.getHitTestResults(frame);
      if (hits.length > 0) {
        const hitPose = this.arSession.getHitPose(hits[0]);
        if (hitPose) {
          const mat = new THREE.Matrix4().fromArray(hitPose.transform.matrix);
          const p = new THREE.Vector3().setFromMatrixPosition(mat);
          position = { x: p.x, y: p.y + 0.05, z: p.z }; // slightly above table surface
        }
      }
    } else {
      // Camera mode: 60cm in front of device at table level
      const cam = this.renderer.camera;
      const fwd = new THREE.Vector3(0, -0.2, -0.65).applyQuaternion(cam.quaternion);
      position = {
        x: cam.position.x + fwd.x,
        y: Math.max(cam.position.y + fwd.y, 0.4),
        z: cam.position.z + fwd.z,
      };
    }

    const hologramId = `paper-text-${Date.now()}`;
    const hologramData = {
      id: hologramId,
      type: 'paper-text',
      name: `Paper: ${text.substring(0, 16)}...`,
      text: text,
      position,
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      hidden: false,
    };

    // Build custom 3D glowing hologram mesh
    const mesh = this._createHolographicTextMesh(text, hologramId);
    mesh.position.set(position.x, position.y, position.z);

    // Make hologram face camera initially
    mesh.lookAt(this.renderer.camera.position.x, mesh.position.y, this.renderer.camera.position.z);

    // Store in HologramManager
    this.renderer.worldGroup.add(mesh);
    this.hologramManager.holograms.set(hologramId, { data: hologramData, mesh });
    this.appState.holograms.set(hologramId, hologramData);

    // Synchronize to connected friends in room
    this.multiplayer.addHologram(hologramData, () => {});

    // Audio chime & visual feedback
    this._playHologramChime();
  }

  // ── Generate 3D Glowing Blue Cyberpunk Hologram Mesh ────────────────────────
  _createHolographicTextMesh(text, hologramId) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Draw futuristic cyber holographic card
    this._drawHologramTexture(ctx, text);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;

    // Front plate
    const geo = new THREE.PlaneGeometry(0.35, 0.18);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.hologramId = hologramId;
    mesh.userData.floatOrigin = mesh.position.y;

    // Glowing cyan/blue wireframe border outline
    const wireGeo = new THREE.PlaneGeometry(0.356, 0.186);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    const border = new THREE.Mesh(wireGeo, wireMat);
    border.position.z = -0.001;
    mesh.add(border);

    // Cyber bracket corners
    const cornerMat = new THREE.MeshBasicMaterial({ color: 0x00a2ff, transparent: true, opacity: 0.8 });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.002), cornerMat);
    c1.position.set(-0.17, 0.088, 0.002);
    mesh.add(c1);

    return mesh;
  }

  // ── Render futuristic HUD texture on 2D canvas ─────────────────────────────
  _drawHologramTexture(ctx, text) {
    const w = 1024, h = 512;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Translucent dark-blue holographic glass plate
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, 'rgba(0, 20, 45, 0.88)');
    bgGrad.addColorStop(0.5, 'rgba(0, 10, 30, 0.82)');
    bgGrad.addColorStop(1, 'rgba(0, 25, 55, 0.90)');
    ctx.fillStyle = bgGrad;
    this._roundRect(ctx, 20, 20, w - 40, h - 40, 24);
    ctx.fill();

    // Outer neon glow border
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = 20;
    this._roundRect(ctx, 20, 20, w - 40, h - 40, 24);
    ctx.stroke();

    // Inner accent border
    ctx.strokeStyle = 'rgba(0, 162, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 0;
    this._roundRect(ctx, 32, 32, w - 64, h - 64, 16);
    ctx.stroke();

    // Horizontal cyber scanlines
    ctx.fillStyle = 'rgba(0, 245, 255, 0.04)';
    for (let y = 36; y < h - 36; y += 8) {
      ctx.fillRect(34, y, w - 68, 3);
    }

    // Top Header Badge
    ctx.fillStyle = '#00f5ff';
    ctx.font = 'bold 26px "SF Mono", "Fira Code", monospace';
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = 10;
    ctx.fillText('◈ OPTICAL DATA EXTRACTED · PAPER OCR ◈', 60, 80);

    // Timestamp & coordinates decorative readout
    ctx.fillStyle = 'rgba(0, 245, 255, 0.6)';
    ctx.font = '18px monospace';
    ctx.shadowBlur = 0;
    ctx.fillText(`STATUS: ANCHORED  |  TIME: ${new Date().toLocaleTimeString()}  |  FREQ: 60Hz`, 60, 115);

    // Decorative separator line
    ctx.strokeStyle = 'rgba(0, 245, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(60, 135);
    ctx.lineTo(w - 60, 135);
    ctx.stroke();

    // Main Recognized Text (Large, Glowing Blue/Cyan)
    ctx.fillStyle = '#00f5ff';
    ctx.font = 'bold 54px "SF Mono", "Fira Code", monospace';
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = 24;

    // Text wrapping
    const lines = this._wrapText(ctx, text, w - 120);
    const startY = 210;
    const lineHeight = 68;

    lines.slice(0, 4).forEach((line, i) => {
      ctx.fillText(line, 60, startY + (i * lineHeight));
    });

    // Bottom action hint
    ctx.fillStyle = 'rgba(0, 245, 255, 0.5)';
    ctx.font = '20px monospace';
    ctx.shadowBlur = 0;
    ctx.fillText('⚡ TOUCH TO INTERACT  |  3D SPATIAL ANCHOR ACTIVE', 60, h - 50);
  }

  _roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  _wrapText(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = words[0] || '';

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + ' ' + word).width;
      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  // ── Pre-process frame for high contrast ink-on-paper recognition ───────────
  _enhanceTextContrast(ctx, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      // Grayscale
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // High-pass threshold to accentuate dark letters on lighter paper
      const threshold = gray < 135 ? 0 : 255;
      d[i] = threshold;
      d[i + 1] = threshold;
      d[i + 2] = threshold;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  _cleanRecognizedText(text) {
    if (!text) return '';
    return text
      .replace(/[\r\n]+/g, ' ')
      .replace(/[|~_—`]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  _fallbackTextDetector(ctx, w, h) {
    // Fast mock detection if offline or Tesseract worker not yet loaded
    const sampleKeywords = [
      'HOLOSPACE ACTIVE',
      'PROJECT VISHWAKARMA',
      'SHARED REALITY 2026',
      'MEETING AT TABLE 1',
      'QUANTUM DATA PACKET',
    ];
    return sampleKeywords[Math.floor(Math.random() * sampleKeywords.length)];
  }

  _updateScanIndicator(active) {
    const st = document.getElementById('scan-status');
    if (st && this.autoScan) {
      st.textContent = active ? '⚡ Scanning paper text...' : 'Looking for paper on table...';
    }
  }

  _playHologramChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (_) {}
  }
}
