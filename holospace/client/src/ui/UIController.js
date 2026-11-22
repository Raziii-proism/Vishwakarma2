/**
 * UIController — Wires all UI elements to subsystem actions.
 * Handles toolbar, panels, hologram list, peers, scan workflow.
 */

import * as THREE from 'three';
import { notify } from './notifications.js';

export class UIController {
  constructor({ arSession, renderer, hologramManager, multiplayer, scanner, calibrator, paperReader, AppState }) {
    this.arSession = arSession;
    this.renderer = renderer;
    this.hologramManager = hologramManager;
    this.multiplayer = multiplayer;
    this.scanner = scanner;
    this.calibrator = calibrator;
    this.paperReader = paperReader;
    this.AppState = AppState;

    this._init();
  }

  _init() {
    this._bindToolbar();
    this._bindWebXRButton();
    this._bindMenu();
    this._bindPeersPanel();
    this._bindObjectControls();
    this._bindHologramEvents();
    this._bindMultiplayerEvents();
    this._bindPanelClose();
    this._bindScannerEvents();
    this._handlePendingRoomCode();
    this._bindSettingsToggles();

    // Start voice trigger if available
    this.scanner.setupVoiceTrigger?.();
  }

  // ── Toolbar Buttons ─────────────────────────────────────────────────────────
  _bindToolbar() {
    const btnRead = document.getElementById('btn-read-paper');
    const btnScan = document.getElementById('btn-scan');
    const btnPlace = document.getElementById('btn-place');
    const btnCalibrate = document.getElementById('btn-calibrate');
    const btnMenu = document.getElementById('btn-menu');
    const btnPeers = document.getElementById('btn-peers');

    // READ PAPER (OCR) button
    if (btnRead) {
      btnRead.addEventListener('click', () => {
        if (!this.paperReader) return;
        btnRead.classList.toggle('ocr-active');
        const isActive = this.paperReader.toggleAutoScan();
        btnRead.querySelector('span').textContent = isActive ? 'READING' : 'READ';
      });

      // Long press / double click for quick manual scan or test paper text input
      btnRead.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const custom = prompt('Enter text to project as 3D blue hologram:', 'MEETING AT 5 PM');
        if (custom) this.paperReader?.manualReadPaper(custom);
      });
    }

    // SCAN button
    btnScan.addEventListener('click', () => {
      if (this.AppState.isScanning) {
        this._stopScan();
      } else {
        this._startScan();
      }
    });

    // PLACE button (place a primitive hologram at reticle)
    btnPlace.addEventListener('click', () => {
      this._placePrimitive();
    });

    // ALIGN/CALIBRATE button
    btnCalibrate.addEventListener('click', () => {
      this._calibrate();
    });

    // MENU button
    btnMenu.addEventListener('click', () => {
      this._togglePanel('menu-panel');
    });

    // PEERS button
    btnPeers.addEventListener('click', () => {
      this._togglePanel('peers-panel');
      this._refreshPeersList();
    });

    // Scan cancel
    document.getElementById('btn-scan-cancel').addEventListener('click', () => {
      this._stopScan();
    });
  }

  _startScan() {
    const name = prompt('Name this object:', 'Object') || 'Object';
    document.getElementById('btn-scan').classList.add('scanning');
    document.getElementById('btn-scan').querySelector('span').textContent = 'SCANNING';
    document.getElementById('reticle').classList.add('scanning');
    document.getElementById('scan-progress-wrap').style.display = 'flex';
    document.getElementById('scan-status').textContent = 'Move phone around object';

    this.scanner.startScan(name, (progress) => {
      const pct = Math.round(progress * 100);
      document.getElementById('scan-progress-fill').style.width = `${pct}%`;
      document.getElementById('scan-progress-label').textContent = `Scanning... ${pct}%`;
      document.getElementById('scan-status').textContent = `Capturing ${pct}%`;
    });
  }

  _stopScan() {
    this.scanner.stopScan?.();
    this._resetScanUI();
  }

  _resetScanUI() {
    document.getElementById('btn-scan').classList.remove('scanning');
    document.getElementById('btn-scan').querySelector('span').textContent = 'SCAN';
    document.getElementById('reticle').classList.remove('scanning');
    document.getElementById('scan-progress-wrap').style.display = 'none';
    document.getElementById('scan-status').textContent = '';
    this.AppState.isScanning = false;
  }

  _placePrimitive() {
    // Place a primitive hologram at hit-test position or in front of camera
    const frame = this.arSession.xrFrame;
    let position = { x: 0, y: 0, z: -0.5 };

    if (frame && this.arSession.mode === 'webxr') {
      const reticlePos = this.calibrator.getReticlePosition(frame);
      if (reticlePos) {
        position = {
          x: reticlePos.position.x,
          y: reticlePos.position.y,
          z: reticlePos.position.z,
        };
      }
    } else {
      // Place 50cm in front of camera
      const cam = this.renderer.camera;
      const dir = new THREE.Vector3(0, 0, -0.5).applyQuaternion(cam.quaternion);
      position = {
        x: cam.position.x + dir.x,
        y: cam.position.y + dir.y,
        z: cam.position.z + dir.z,
      };
    }

    const hologramData = {
      type: 'primitive',
      shape: 'sphere',
      name: 'Hologram',
      color: '#00f5ff',
      position,
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
    };

    this.multiplayer.addHologram(hologramData, (result) => {
      if (result?.ok && result.hologram) {
        this.hologramManager.addHologram(result.hologram);
        this._refreshHologramList();
        notify('"Hologram" placed', 'success');
      } else {
        hologramData.id = `local-${Date.now()}`;
        this.hologramManager.addHologram(hologramData);
        this._refreshHologramList();
      }
    });
  }

  _calibrate() {
    if (this.arSession.mode === 'webxr') {
      const frame = this.arSession.xrFrame;
      if (frame) {
        this.calibrator.setWorldOriginFromHitTest(frame).then(ok => {
          if (ok) notify('World origin aligned to surface', 'success');
        });
      } else {
        notify('Enter AR mode first to calibrate', 'error');
      }
    } else {
      this.calibrator.setWorldOriginFromCamera();
      notify('World origin set to current position', 'success');
    }
  }

  // ── WebXR Enter AR Button ──────────────────────────────────────────────────
  _bindWebXRButton() {
    const btn = document.getElementById('btn-enter-webxr');
    if (btn) {
      btn.addEventListener('click', () => {
        this.arSession.startWebXRSession?.();
        btn.style.display = 'none';
      });
    }
  }

  // ── Panel Management ────────────────────────────────────────────────────────
  _togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isOpen = panel.style.display !== 'none' && panel.classList.contains('open');
    // Close all panels first
    document.querySelectorAll('.side-panel').forEach(p => {
      p.classList.remove('open');
      setTimeout(() => { if (!p.classList.contains('open')) p.style.display = 'none'; }, 300);
    });
    if (!isOpen) {
      panel.style.display = 'flex';
      requestAnimationFrame(() => panel.classList.add('open'));
    }
  }

  _bindPanelClose() {
    document.querySelectorAll('.close-panel').forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel;
        const panel = document.getElementById(panelId);
        if (panel) {
          panel.classList.remove('open');
          setTimeout(() => { panel.style.display = 'none'; }, 300);
        }
      });
    });
  }

  // ── Menu Panel ──────────────────────────────────────────────────────────────
  _bindMenu() {
    document.getElementById('btn-create-room').addEventListener('click', () => {
      const name = document.getElementById('input-name').value.trim() || 'Explorer';
      this.multiplayer.createRoom(name, (result) => {
        if (result.ok) {
          this._showInRoomView();
          notify(`Room ${result.roomId} created!`, 'success');
        }
      });
    });

    document.getElementById('btn-join-room').addEventListener('click', () => {
      const code = document.getElementById('input-room-code').value.trim().toUpperCase();
      const name = document.getElementById('input-name').value.trim() || 'Explorer';
      if (!code) { notify('Enter a room code', 'error'); return; }
      this.multiplayer.joinRoom(code, name, (result) => {
        if (result.ok) {
          this._showInRoomView();
          notify(`Joined room ${result.roomId}`, 'success');
          this._refreshHologramList();
        }
      });
    });

    document.getElementById('btn-copy-link').addEventListener('click', () => {
      const url = this.multiplayer.getInviteUrl?.() || location.href;
      navigator.clipboard?.writeText(url)
        .then(() => notify('Invite link copied!', 'success'))
        .catch(() => prompt('Copy this link:', url));
    });

    document.getElementById('btn-leave-room').addEventListener('click', () => {
      location.reload();
    });
  }

  _showInRoomView() {
    document.getElementById('no-room-view').style.display = 'none';
    document.getElementById('in-room-view').style.display = 'block';
  }

  // ── Peers Panel ─────────────────────────────────────────────────────────────
  _bindPeersPanel() {}

  _refreshPeersList() {
    const list = document.getElementById('peers-list');
    list.innerHTML = '';

    // Add self
    const selfLi = document.createElement('li');
    const peerInfo = this.AppState.peerInfo;
    selfLi.innerHTML = `
      <span class="peer-dot" style="background:${peerInfo?.color || '#00f5ff'}"></span>
      <span class="peer-name">${peerInfo?.name || 'You'}</span>
      <span class="peer-badge">YOU</span>
    `;
    list.appendChild(selfLi);

    // Add remote peers
    this.AppState.peers.forEach(peer => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="peer-dot" style="background:${peer.color}"></span>
        <span class="peer-name">${peer.name}</span>
        <span class="peer-distance">${peer.isHost ? '👑 Host' : '✓'}</span>
      `;
      list.appendChild(li);
    });

    document.getElementById('peer-count').textContent = this.AppState.peers.size + 1;
  }

  // ── Object Controls ─────────────────────────────────────────────────────────
  _bindObjectControls() {
    document.getElementById('btn-hide').addEventListener('click', () => {
      if (!this.AppState.selectedHologramId) return;
      const hidden = this.hologramManager.toggleHidden(this.AppState.selectedHologramId);
      notify(hidden ? 'Original hidden (hologram remains)' : 'Original visible', 'info');
    });

    document.getElementById('btn-delete').addEventListener('click', () => {
      const id = this.AppState.selectedHologramId;
      if (!id) return;
      this.hologramManager.removeHologram(id);
      this.multiplayer.removeHologram(id, () => {});
      this._refreshHologramList();
      notify('Hologram removed', 'info');
    });

    document.getElementById('btn-deselect').addEventListener('click', () => {
      this.hologramManager.deselect();
    });

    document.getElementById('scale-slider').addEventListener('input', (e) => {
      const id = this.AppState.selectedHologramId;
      if (!id) return;
      const scale = parseFloat(e.target.value);
      const data = this.hologramManager.setScaleSelected(scale);
      if (data) {
        this.multiplayer.updateHologram({ id, scale: data.scale });
      }
    });
  }

  // ── Hologram Events ─────────────────────────────────────────────────────────
  _bindHologramEvents() {
    document.addEventListener('hologram:selected', (e) => {
      const id = e.detail.id;
      const data = this.AppState.holograms.get(id);
      document.getElementById('object-controls').style.display = 'flex';
      document.getElementById('selected-name').textContent = data?.name || 'Object';
      const t = this.hologramManager.getTransform(id);
      if (t) {
        document.getElementById('scale-slider').value = t.scale.x;
      }
    });

    document.addEventListener('hologram:deselected', () => {
      document.getElementById('object-controls').style.display = 'none';
    });
  }

  // ── Multiplayer Events ──────────────────────────────────────────────────────
  _bindMultiplayerEvents() {
    document.addEventListener('peers:updated', () => {
      document.getElementById('peer-count').textContent = this.AppState.peers.size + 1;
    });

    document.addEventListener('world:originReceived', (e) => {
      this.calibrator.receiveWorldOrigin(e.detail.matrix);
    });
  }

  // ── Scanner events (from voice trigger) ────────────────────────────────────
  _bindScannerEvents() {
    document.addEventListener('scanner:start', () => { this._startScan(); });
    document.addEventListener('scanner:stop', () => {
      this.scanner.finalizeScan?.();
      this._resetScanUI();
    });
  }

  // ── Handle pending room code from URL ──────────────────────────────────────
  _handlePendingRoomCode() {
    if (window.pendingRoomCode) {
      document.getElementById('input-room-code').value = window.pendingRoomCode;
      // Auto-open the menu
      setTimeout(() => {
        this._togglePanel('menu-panel');
        notify(`Room code ${window.pendingRoomCode} pre-filled — enter your name and join!`, 'info');
      }, 1000);
    }
  }

  // ── Settings toggles ────────────────────────────────────────────────────────
  _bindSettingsToggles() {
    document.getElementById('toggle-peers-3d').addEventListener('change', (e) => {
      this.AppState.showPeers3D = e.target.checked;
    });
    document.getElementById('toggle-shadows').addEventListener('change', (e) => {
      this.AppState.showShadows = e.target.checked;
      this.renderer.setShadowsEnabled(e.target.checked);
    });
  }

  // ── Hologram list in menu ──────────────────────────────────────────────────
  _refreshHologramList() {
    const container = document.getElementById('hologram-list-container');
    container.innerHTML = '';
    const holograms = this.hologramManager.getAllData();
    if (holograms.length === 0) {
      container.innerHTML = '<p class="empty-hint">No holograms placed yet.</p>';
      return;
    }
    holograms.forEach(h => {
      const div = document.createElement('div');
      div.className = 'hologram-item';
      div.innerHTML = `
        <span class="h-name">${h.name || h.id}</span>
        <button title="Select" data-id="${h.id}" class="h-select">◎</button>
        <button title="Delete" data-id="${h.id}" class="h-delete">✕</button>
      `;
      div.querySelector('.h-select').addEventListener('click', () => {
        this.hologramManager.select(h.id);
      });
      div.querySelector('.h-delete').addEventListener('click', () => {
        this.hologramManager.removeHologram(h.id);
        this.multiplayer.removeHologram(h.id, () => {});
        this._refreshHologramList();
      });
      container.appendChild(div);
    });
  }
}


