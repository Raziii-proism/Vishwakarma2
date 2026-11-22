/**
 * MultiplayerManager — Real-time synchronization of holographic world state.
 *
 * Uses Socket.IO for signaling and state sync:
 *   - Room creation and joining
 *   - Peer pose broadcasting (throttled to 20Hz)
 *   - Hologram CRUD operations
 *   - Spatial anchor negotiation
 *   - World origin sharing
 */

import { io } from 'socket.io-client';
import { notify } from '../ui/notifications.js';

// ── Server URL: can be overridden via localStorage or UI settings ────────────
const SERVER_URL = (() => {
  const custom = localStorage.getItem('holospace_server_url');
  if (custom) return custom;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }
  // When deployed to Vercel/cloud without custom backend URL set
  return null;
})();

const POSE_THROTTLE_MS = 50; // 20Hz pose updates

export class MultiplayerManager {
  constructor(appState, hologramManager, renderer) {
    this.appState = appState;
    this.hologramManager = hologramManager;
    this.renderer = renderer;

    this.socket = null;
    this.connected = false;
    this.roomId = null;
    this._lastPoseBroadcast = 0;
    this._poseAccumulator = null;

    this._connect();
    this._listenForHologramEvents();
  }

  // ── Socket connection ───────────────────────────────────────────────────────
  _connect() {
    if (!SERVER_URL) {
      this._updateConnectionStatus('waiting', 'LOCAL AR');
      return;
    }

    try {
      this.socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10,
      });

      this.socket.on('connect', () => {
        this.connected = true;
        this.appState.peerId = this.socket.id;
        this._updateConnectionStatus('online', 'ONLINE');
        console.log('[Multiplayer] Connected:', this.socket.id);
        document.dispatchEvent(new Event('multiplayer:connected'));
      });

      this.socket.on('disconnect', (reason) => {
        this.connected = false;
        this._updateConnectionStatus('offline', 'LOCAL AR');
        console.warn('[Multiplayer] Disconnected:', reason);
        document.dispatchEvent(new Event('multiplayer:disconnected'));
      });

      this.socket.on('connect_error', (err) => {
        this._updateConnectionStatus('waiting', 'LOCAL AR');
        console.warn('[Multiplayer] Backend not connected, running in local AR mode');
      });

      // ── Peer events ─────────────────────────────────────────────────────────
      this.socket.on('peer:joined', ({ peer }) => {
        this.appState.peers.set(peer.id, peer);
        this.renderer.addPeerAvatar(peer.id, peer.color);
        notify(`${peer.name} joined the room`, 'info');
        document.dispatchEvent(new CustomEvent('peers:updated', { detail: { peers: this.appState.peers } }));
      });

      this.socket.on('peer:left', ({ peerId, name }) => {
        this.appState.peers.delete(peerId);
        this.renderer.removePeerAvatar(peerId);
        notify(`${name} left the room`, 'info');
        document.dispatchEvent(new CustomEvent('peers:updated', { detail: { peers: this.appState.peers } }));
      });

      this.socket.on('peer:pose', ({ peerId, pose }) => {
        const peer = this.appState.peers.get(peerId);
        if (peer) peer.pose = pose;
        if (this.appState.showPeers3D) {
          this.renderer.updatePeerAvatar(peerId, pose);
        }
      });

      // ── World origin ─────────────────────────────────────────────────────────
      this.socket.on('world:origin', (anchor) => {
        document.dispatchEvent(new CustomEvent('world:originReceived', { detail: anchor }));
      });

      // ── Hologram events ──────────────────────────────────────────────────────
      this.socket.on('hologram:added', (hologram) => {
        if (!this.appState.holograms.has(hologram.id)) {
          this.hologramManager.addHologram(hologram);
          notify(`${hologram.name || 'Object'} hologram shared by peer`, 'info');
        }
      });

      this.socket.on('hologram:updated', (update) => {
        this.hologramManager.updateHologram(update);
      });

      this.socket.on('hologram:removed', ({ id }) => {
        this.hologramManager.removeHologram(id);
      });
    } catch (e) {
      this._updateConnectionStatus('waiting', 'LOCAL AR');
    }
  }

  // ── Listen to local hologram moves for sync ─────────────────────────────────
  _listenForHologramEvents() {
    document.addEventListener('hologram:localMoved', (e) => {
      if (this.connected && this.socket && this.roomId) {
        this.socket.emit('hologram:update', e.detail);
      }
    });
  }

  // ── Room management ─────────────────────────────────────────────────────────
  createRoom(name, callback) {
    if (!this.connected || !this.socket) {
      // Local / Offline standalone room
      const roomId = Math.random().toString(36).substring(2, 10).toUpperCase();
      this.roomId = roomId;
      this.appState.roomId = roomId;
      const peer = { id: 'local-user', name: name || 'Explorer', color: '#00f5ff' };
      this.appState.peerInfo = peer;
      this._updateRoomDisplay(roomId);
      callback?.({ ok: true, roomId, peer, isOffline: true });
      return;
    }

    this.socket.emit('room:create', { name }, (result) => {
      if (result.ok) {
        this.roomId = result.roomId;
        this.appState.roomId = result.roomId;
        this.appState.peerInfo = result.peer;
        this._updateRoomDisplay(result.roomId);
        callback?.(result);
      } else {
        notify('Failed to create room', 'error');
        callback?.(result);
      }
    });
  }

  joinRoom(roomId, name, callback) {
    if (!this.connected || !this.socket) {
      this.roomId = roomId;
      this.appState.roomId = roomId;
      const peer = { id: 'local-user', name: name || 'Explorer', color: '#ff6b35' };
      this.appState.peerInfo = peer;
      this._updateRoomDisplay(roomId);
      callback?.({ ok: true, roomId, peer, peers: [], holograms: [], isOffline: true });
      return;
    }

    this.socket.emit('room:join', { roomId, name }, (result) => {
      if (result.ok) {
        this.roomId = result.roomId;
        this.appState.roomId = result.roomId;
        this.appState.peerInfo = result.peer;

        // Populate existing peers
        result.peers?.forEach(peer => {
          if (peer.id !== this.socket.id) {
            this.appState.peers.set(peer.id, peer);
            this.renderer.addPeerAvatar(peer.id, peer.color);
          }
        });

        // Load existing holograms
        result.holograms?.forEach(h => this.hologramManager.addHologram(h));

        // Receive world origin if set
        if (result.spatialAnchors?.length > 0) {
          const worldAnchor = result.spatialAnchors.find(a => a.id === 'world-origin' || a);
          if (worldAnchor?.matrix) {
            document.dispatchEvent(new CustomEvent('world:originReceived', { detail: worldAnchor }));
          }
        }

        this._updateRoomDisplay(result.roomId);
        document.dispatchEvent(new CustomEvent('peers:updated', { detail: { peers: this.appState.peers } }));
        callback?.(result);
      } else {
        notify(result.error || 'Failed to join room', 'error');
        callback?.(result);
      }
    });
  }

  // ── World origin ─────────────────────────────────────────────────────────────
  setWorldOrigin(matrixArray, callback) {
    if (!this.socket || !this.roomId) return;
    this.socket.emit('world:setOrigin', { matrix: matrixArray }, callback);
  }

  // ── Hologram CRUD ─────────────────────────────────────────────────────────────
  addHologram(hologramData, callback) {
    if (!this.socket || !this.roomId) {
      // Offline mode: create local ID and call back directly
      const local = { ...hologramData, id: `local-${Date.now()}` };
      callback?.({ ok: true, hologram: local });
      return;
    }
    this.socket.emit('hologram:add', hologramData, callback);
  }

  updateHologram(update) {
    if (!this.socket || !this.roomId) return;
    this.socket.emit('hologram:update', update);
  }

  removeHologram(id, callback) {
    if (!this.socket || !this.roomId) {
      callback?.({ ok: true });
      return;
    }
    this.socket.emit('hologram:remove', { id }, callback);
  }

  toggleHologramVisibility(id, visible) {
    if (!this.socket || !this.roomId) return;
    this.socket.emit('hologram:visibility', { id, visible });
  }

  // ── Throttled pose broadcasting ───────────────────────────────────────────────
  updatePoseBroadcast(pose) {
    if (!this.connected || !this.roomId) return;
    const now = performance.now();
    if (now - this._lastPoseBroadcast < POSE_THROTTLE_MS) return;
    this._lastPoseBroadcast = now;
    this.socket.emit('pose:update', pose);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────
  _updateConnectionStatus(state, label) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (dot) { dot.className = `status-dot ${state}`; }
    if (text) text.textContent = label;
  }

  _updateRoomDisplay(roomId) {
    const display = document.getElementById('room-code-display');
    const activeCode = document.getElementById('active-room-code');
    if (display) display.textContent = roomId;
    if (activeCode) activeCode.textContent = roomId;
    document.getElementById('peer-count').textContent = this.appState.peers.size + 1;
  }

  getInviteUrl() {
    return `${location.origin}?room=${this.roomId}`;
  }

  get isConnected() { return this.connected; }
  get currentRoomId() { return this.roomId; }
}
