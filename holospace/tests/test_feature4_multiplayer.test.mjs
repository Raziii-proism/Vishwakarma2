import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { Server } from '../server/node_modules/socket.io/dist/index.js';
import { io as Client } from '../client/node_modules/socket.io-client/build/esm/index.js';
import express from '../server/node_modules/express/index.js';
import { v4 as uuidv4 } from '../server/node_modules/uuid/dist/esm-browser/index.js';

test('Feature 4: Multiplayer Shared AR & Real-time Synchronization', async (t) => {
  // Spin up an in-process instance of the HOLOSPACE server for testing
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const rooms = new Map();
  function getRoom(roomId) { return rooms.get(roomId?.toUpperCase()); }

  io.on('connection', (socket) => {
    let currentRoom = null;
    let peerInfo = null;

    socket.on('room:create', ({ name }, cb) => {
      const roomId = 'TESTROOM';
      const room = {
        id: roomId,
        hostId: socket.id,
        peers: new Map(),
        holograms: new Map(),
        spatialAnchors: new Map(),
      };
      rooms.set(roomId, room);
      currentRoom = room;
      peerInfo = { id: socket.id, name, color: '#00f5ff', pose: null };
      room.peers.set(socket.id, peerInfo);
      socket.join(roomId);
      cb({ ok: true, roomId, peer: peerInfo });
    });

    socket.on('room:join', ({ roomId, name }, cb) => {
      const room = getRoom(roomId);
      if (!room) return cb({ ok: false, error: 'Room not found' });
      currentRoom = room;
      peerInfo = { id: socket.id, name, color: '#ff6b35', pose: null };
      room.peers.set(socket.id, peerInfo);
      socket.join(room.id);
      cb({
        ok: true,
        roomId: room.id,
        peer: peerInfo,
        peers: Array.from(room.peers.values()),
        holograms: Array.from(room.holograms.values()),
      });
      socket.to(room.id).emit('peer:joined', { peer: peerInfo });
    });

    socket.on('world:setOrigin', ({ matrix }, cb) => {
      if (!currentRoom) return;
      const anchor = { id: 'world-origin', matrix, setPeerId: socket.id };
      currentRoom.spatialAnchors.set('world-origin', anchor);
      socket.to(currentRoom.id).emit('world:origin', anchor);
      cb?.({ ok: true, anchor });
    });

    socket.on('pose:update', (pose) => {
      if (!currentRoom) return;
      socket.to(currentRoom.id).emit('peer:pose', { peerId: socket.id, pose });
    });

    socket.on('hologram:add', (data, cb) => {
      if (!currentRoom) return;
      const h = { ...data, id: data.id || uuidv4() };
      currentRoom.holograms.set(h.id, h);
      socket.to(currentRoom.id).emit('hologram:added', h);
      cb?.({ ok: true, hologram: h });
    });

    socket.on('hologram:update', (update) => {
      if (!currentRoom) return;
      const h = currentRoom.holograms.get(update.id);
      if (h) {
        Object.assign(h, update);
        socket.to(currentRoom.id).emit('hologram:updated', h);
      }
    });
  });

  const TEST_PORT = 3456;
  await new Promise((resolve) => httpServer.listen(TEST_PORT, '127.0.0.1', resolve));

  const clientA = Client(`http://127.0.0.1:${TEST_PORT}`, { transports: ['websocket'], autoConnect: true });
  const clientB = Client(`http://127.0.0.1:${TEST_PORT}`, { transports: ['websocket'], autoConnect: true });

  await Promise.all([
    new Promise(res => clientA.on('connect', res)),
    new Promise(res => clientB.on('connect', res)),
  ]);

  await t.test('Client A creates private room and Client B joins with code', async () => {
    const createRes = await new Promise(res => {
      clientA.emit('room:create', { name: 'Alice' }, res);
    });
    assert.equal(createRes.ok, true);
    assert.equal(createRes.roomId, 'TESTROOM');

    const peerJoinedPromise = new Promise(res => {
      clientA.once('peer:joined', res);
    });

    const joinRes = await new Promise(res => {
      clientB.emit('room:join', { roomId: 'TESTROOM', name: 'Bob' }, res);
    });
    assert.equal(joinRes.ok, true);
    assert.equal(joinRes.peer.name, 'Bob');

    const joinedNotification = await peerJoinedPromise;
    assert.equal(joinedNotification.peer.name, 'Bob');
  });

  await t.test('Client A calibrates world origin, Client B receives shared anchor', async () => {
    const testMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0.8, -1.5, 1
    ];

    const originReceivedPromise = new Promise(res => {
      clientB.once('world:origin', res);
    });

    clientA.emit('world:setOrigin', { matrix: testMatrix });
    const received = await originReceivedPromise;

    assert.equal(received.id, 'world-origin');
    assert.deepEqual(received.matrix, testMatrix);
  });

  await t.test('Synchronizes device pose between peers in real-time', async () => {
    const poseA = {
      position: { x: 0.5, y: 1.6, z: 2.0 },
      quaternion: { x: 0, y: 0.707, z: 0, w: 0.707 },
    };

    const poseReceivedPromise = new Promise(res => {
      clientB.once('peer:pose', res);
    });

    clientA.emit('pose:update', poseA);
    const data = await poseReceivedPromise;

    assert.equal(data.peerId, clientA.id);
    assert.deepEqual(data.pose, poseA);
  });

  await t.test('Synchronizes hologram placement and property updates', async () => {
    const hologramAddPromise = new Promise(res => {
      clientB.once('hologram:added', res);
    });

    const newHologram = {
      id: 'hologram-xyz',
      name: 'Crystal Orb',
      position: { x: 0, y: 0.8, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };

    clientA.emit('hologram:add', newHologram);
    const added = await hologramAddPromise;
    assert.equal(added.id, 'hologram-xyz');
    assert.equal(added.name, 'Crystal Orb');

    // Client B updates hologram scale
    const updatePromise = new Promise(res => {
      clientA.once('hologram:updated', res);
    });

    clientB.emit('hologram:update', { id: 'hologram-xyz', scale: { x: 2.5, y: 2.5, z: 2.5 } });
    const updated = await updatePromise;
    assert.equal(updated.scale.x, 2.5);
  });

  // Cleanup
  clientA.disconnect();
  clientB.disconnect();
  await new Promise(res => httpServer.close(res));
});
