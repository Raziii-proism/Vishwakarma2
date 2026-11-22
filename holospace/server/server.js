/**
 * HOLOSPACE - Multiplayer Mixed Reality Server
 * Handles real-time synchronization of holographic objects, 
 * room management, spatial anchors, and peer coordination.
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ─── Room State Store ─────────────────────────────────────────────────────────
// rooms: Map<roomId, RoomState>
const rooms = new Map();

function createRoom(hostId, hostName) {
  const roomId = uuidv4().split('-')[0].toUpperCase(); // Short 8-char code
  const inviteLink = `holospace://${roomId}`;
  const room = {
    id: roomId,
    inviteLink,
    hostId,
    createdAt: Date.now(),
    peers: new Map(), // socketId -> PeerInfo
    holograms: new Map(), // hologramId -> HologramState
    spatialAnchors: new Map(), // anchorId -> AnchorState
    worldOriginPeerId: null, // who set the world origin
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId?.toUpperCase());
}

function serializePeers(room) {
  return Array.from(room.peers.values()).map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    pose: p.pose,
    isHost: p.id === room.hostId,
  }));
}

function serializeHolograms(room) {
  return Array.from(room.holograms.values());
}

function serializeSpatialAnchors(room) {
  return Array.from(room.spatialAnchors.values());
}

// ─── Peer Colors ──────────────────────────────────────────────────────────────
const PEER_COLORS = [
  '#00f5ff', '#ff6b35', '#7fff00', '#ff00ff', '#ffd700',
  '#ff4500', '#00ff87', '#ff69b4', '#40e0d0', '#ff8c00'
];
let colorIndex = 0;
function nextColor() {
  return PEER_COLORS[colorIndex++ % PEER_COLORS.length];
}

// ─── HTTP Routes ──────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', rooms: rooms.size }));

app.get('/room/:roomId', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    id: room.id,
    peers: serializePeers(room),
    hologramCount: room.holograms.size,
  });
});

// ─── Socket.IO Logic ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null;
  let peerInfo = null;

  console.log(`[+] Peer connected: ${socket.id}`);

  // ── Create Room ──────────────────────────────────────────────────────────
  socket.on('room:create', ({ name }, callback) => {
    const room = createRoom(socket.id, name);
    currentRoom = room;
    peerInfo = {
      id: socket.id,
      name: name || 'Explorer',
      color: nextColor(),
      pose: null,
      joinedAt: Date.now(),
    };
    room.peers.set(socket.id, peerInfo);
    socket.join(room.id);

    console.log(`[Room] ${room.id} created by ${name}`);
    callback({
      ok: true,
      roomId: room.id,
      inviteLink: room.inviteLink,
      peer: peerInfo,
    });
  });

  // ── Join Room ────────────────────────────────────────────────────────────
  socket.on('room:join', ({ roomId, name }, callback) => {
    const room = getRoom(roomId);
    if (!room) {
      callback({ ok: false, error: 'Room not found. Check the code and try again.' });
      return;
    }

    currentRoom = room;
    peerInfo = {
      id: socket.id,
      name: name || 'Explorer',
      color: nextColor(),
      pose: null,
      joinedAt: Date.now(),
    };
    room.peers.set(socket.id, peerInfo);
    socket.join(room.id);

    // Send current world state to new peer
    callback({
      ok: true,
      roomId: room.id,
      peer: peerInfo,
      peers: serializePeers(room),
      holograms: serializeHolograms(room),
      spatialAnchors: serializeSpatialAnchors(room),
      worldOriginPeerId: room.worldOriginPeerId,
    });

    // Notify others
    socket.to(room.id).emit('peer:joined', { peer: peerInfo });
    console.log(`[Room] ${room.id}: ${name} joined (${room.peers.size} peers)`);
  });

  // ── Pose Update (device position/orientation) ────────────────────────────
  socket.on('pose:update', (pose) => {
    if (!currentRoom || !peerInfo) return;
    peerInfo.pose = pose;
    // Broadcast to others in the room (not back to sender)
    socket.to(currentRoom.id).emit('peer:pose', {
      peerId: socket.id,
      pose,
    });
  });

  // ── Set World Origin (spatial calibration) ───────────────────────────────
  socket.on('world:setOrigin', ({ matrix, anchorId }, callback) => {
    if (!currentRoom) return;
    currentRoom.worldOriginPeerId = socket.id;
    const anchor = { id: anchorId || uuidv4(), matrix, setPeerId: socket.id, timestamp: Date.now() };
    currentRoom.spatialAnchors.set('world-origin', anchor);
    socket.to(currentRoom.id).emit('world:origin', anchor);
    callback?.({ ok: true, anchor });
  });

  // ── Hologram: Add ────────────────────────────────────────────────────────
  socket.on('hologram:add', (hologramData, callback) => {
    if (!currentRoom) return;
    const hologram = {
      ...hologramData,
      id: hologramData.id || uuidv4(),
      creatorId: socket.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    currentRoom.holograms.set(hologram.id, hologram);
    socket.to(currentRoom.id).emit('hologram:added', hologram);
    callback?.({ ok: true, hologram });
    console.log(`[Hologram] Added "${hologram.name}" in room ${currentRoom.id}`);
  });

  // ── Hologram: Update (move, rotate, scale) ───────────────────────────────
  socket.on('hologram:update', (update) => {
    if (!currentRoom) return;
    const hologram = currentRoom.holograms.get(update.id);
    if (!hologram) return;
    Object.assign(hologram, update, { updatedAt: Date.now() });
    socket.to(currentRoom.id).emit('hologram:updated', hologram);
  });

  // ── Hologram: Remove ─────────────────────────────────────────────────────
  socket.on('hologram:remove', ({ id }, callback) => {
    if (!currentRoom) return;
    const removed = currentRoom.holograms.delete(id);
    if (removed) {
      socket.to(currentRoom.id).emit('hologram:removed', { id });
    }
    callback?.({ ok: removed });
  });

  // ── Hologram: Visibility toggle ──────────────────────────────────────────
  socket.on('hologram:visibility', ({ id, visible }) => {
    if (!currentRoom) return;
    const hologram = currentRoom.holograms.get(id);
    if (hologram) {
      hologram.visible = visible;
      hologram.updatedAt = Date.now();
      socket.to(currentRoom.id).emit('hologram:updated', hologram);
    }
  });

  // ── 3D Scan Data: stream geometry chunks ─────────────────────────────────
  socket.on('scan:chunk', (chunk) => {
    if (!currentRoom) return;
    // Forward scan progress to all peers for live preview
    socket.to(currentRoom.id).emit('scan:chunk', { peerId: socket.id, ...chunk });
  });

  socket.on('scan:complete', (scanData, callback) => {
    if (!currentRoom) return;
    const hologram = {
      id: uuidv4(),
      type: 'scanned',
      name: scanData.name || 'Scanned Object',
      geometry: scanData.geometry,
      texture: scanData.texture,
      position: scanData.position,
      quaternion: scanData.quaternion,
      scale: scanData.scale || { x: 1, y: 1, z: 1 },
      visible: true,
      hidden: false,
      creatorId: socket.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    currentRoom.holograms.set(hologram.id, hologram);
    io.to(currentRoom.id).emit('hologram:added', hologram);
    callback?.({ ok: true, hologram });
  });

  // ── Chat / Events ─────────────────────────────────────────────────────────
  socket.on('event:broadcast', (event) => {
    if (!currentRoom) return;
    socket.to(currentRoom.id).emit('event:broadcast', {
      peerId: socket.id,
      peerName: peerInfo?.name,
      ...event,
      timestamp: Date.now(),
    });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    if (!currentRoom || !peerInfo) return;
    currentRoom.peers.delete(socket.id);
    io.to(currentRoom.id).emit('peer:left', { peerId: socket.id, name: peerInfo.name });
    console.log(`[-] ${peerInfo.name} left room ${currentRoom.id} (${reason})`);

    // Clean up empty rooms after 5 minutes
    if (currentRoom.peers.size === 0) {
      setTimeout(() => {
        if (rooms.get(currentRoom.id)?.peers.size === 0) {
          rooms.delete(currentRoom.id);
          console.log(`[Room] ${currentRoom.id} cleaned up (empty)`);
        }
      }, 5 * 60 * 1000);
    }
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🌌 HOLOSPACE Server running on http://localhost:${PORT}`);
  console.log(`   WebSocket ready for multiplayer AR sessions\n`);
});
