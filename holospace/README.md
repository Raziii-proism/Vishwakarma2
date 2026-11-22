# HOLOSPACE — Installation & Run Guide

## Prerequisites
- Node.js v18+ (detected: v24.19.0)
- npm / pnpm

## Quick Start

### 1. Install Server Dependencies
```bash
cd holospace/server
npm install
```

### 2. Install Client Dependencies
```bash
cd holospace/client
npm install
```

### 3. Start Server
```bash
cd holospace/server
npm start
# Server: http://localhost:3001
```

### 4. Start Client (Dev)
```bash
cd holospace/client
npm run dev
# Client: http://localhost:5173
```

### 5. Access on Phone

**Android Chrome (Full WebXR + ARCore):**
1. Connect PC and phone to the same WiFi
2. Open `http://<your-pc-ip>:5173` in Chrome on Android
3. Grant camera permission
4. Tap ALIGN to set world origin
5. Tap SCAN to scan objects

**iPhone Safari (Camera passthrough mode):**
1. Same network URL
2. Camera + gyroscope tracking (no WebXR)
3. All features work except native hit-test surface detection

## Production Deployment

### Server: Deploy to any Node.js host
```bash
# Set PORT env variable
PORT=3001 node server.js
```

### Client: Static build
```bash
cd holospace/client
npm run build
# Deploy the dist/ folder to any CDN/static host
```

### HTTPS (Required for WebXR on physical devices)
WebXR requires HTTPS. Use ngrok, Cloudflare Tunnel, or a proper TLS cert:
```bash
# Quick HTTPS tunnel for testing
npx ngrok http 5173
```

## Architecture

```
holospace/
├── server/          # Node.js + Socket.IO backend
│   └── server.js    # Room management, real-time sync
└── client/          # Vite + Three.js frontend
    ├── index.html   # App shell
    ├── public/
    │   └── style.css
    └── src/
        ├── main.js                        # Boot orchestrator
        ├── ar/
        │   ├── ARSession.js               # WebXR + camera + orientation
        │   └── SpatialCalibrator.js       # World origin / spatial anchors
        ├── core/
        │   ├── HolospaceRenderer.js       # Three.js scene
        │   └── HologramManager.js        # Hologram lifecycle + interaction
        ├── scanning/
        │   └── ObjectScanner.js          # 3D scanning + reconstruction
        ├── multiplayer/
        │   └── MultiplayerManager.js     # Socket.IO real-time sync
        ├── ui/
        │   ├── UIController.js           # UI event wiring
        │   └── notifications.js          # Toast + loading
        └── utils/
            └── meshBuilder.js            # Mesh construction utilities
```

## Browser Compatibility

| Feature | Android Chrome | iOS Safari | Desktop Chrome |
|---------|---------------|------------|----------------|
| Camera passthrough | ✅ | ✅ | ✅ |
| WebXR hit-test | ✅ ARCore | ❌ | ❌ |
| Orientation tracking | ✅ | ✅* | ❌ |
| Object scanning | ✅ Full | ✅ Fallback | ✅ Fallback |
| Multiplayer sync | ✅ | ✅ | ✅ |
| Shadow rendering | ✅ | ✅ | ✅ |

*iOS requires permission tap for DeviceOrientation

## Feature Details

### Spatial Calibration (Multi-user alignment)
1. Host taps ALIGN → sets world origin at a physical surface
2. Origin matrix is broadcast to all peers via WebSocket
3. All peers transform their worldGroup to the shared origin
4. Holograms placed relative to this origin appear at the same physical position

### Object Scanning
1. Tap SCAN → enter name
2. Move phone slowly around object (all angles)
3. ARCore hit-test samples depth at reticle center each 120ms
4. Point cloud builds up in real-time (shown as orange dots)
5. Tap SCAN again or wait for auto-complete at 60 frames
6. Mesh reconstructed from point cloud, texture captured from camera
7. Hologram placed at original object position, synced to all peers
