# Openterface WebUI

Shared web UI components and WebRTC client for Openterface devices. This repository contains the reusable UI layer and transport logic that powers both the web-based and Android-based Openterface clients.

## Architecture

```
@openterface/core (in Openterface_Web repo)
    ↑           ↑
    |           |
@openterface/control-ui    @openterface/webrtc-core
    ↑           ↑
    |           |
    +-----+-----+
          |
    @openterface/webrtc
```

### Packages

| Package | Description |
|---------|-------------|
| `@openterface/control-ui` | Reusable Vue UI components: Layout, VideoStream, TopBar, BottomBar, StatusBar, ModifierLocks, PasteTextDialog, SettingsModal, etc. |
| `@openterface/webrtc-core` | WebRTC transport layer: RTCPeerConnection signaling, ICE handling, DataChannel management, CH9329→JSON frame translation |
| `@openterface/webrtc` | WebRTC client app — thin wrapper that provides transport and uses control-ui components |

### Dependencies

- `@openterface/core` — referenced from `https://github.com/TechxArtisanStudio/Openterface_Web` (packages/core)
- `vue` — peer dependency

## Development

```bash
npm install
npm -w @openterface/webrtc run dev      # Dev server
npm run build:webrtc:android             # Production build for Android
```

## Build Output

The WebRTC app builds to `packages/webrtc/dist/webrtc-android/`:

```
dist/webrtc-android/
├── index.html
├── keymod.js
├── keymod.wasm
└── assets/
    ├── index-*.js
    └── index-*.css
```

This output is served by the Openterface_Android NanoHTTPD signaling server.

## Integration

### Openterface_Web
References WebUI as a git submodule. The root `package.json` workspaces include `submodules/Openterface_WebUI/packages/*`, making control-ui and webrtc packages available to the USB app.

### Openterface_Android
References WebUI as a git submodule. The Gradle `buildWebClient` task runs `npm install && npm run build:webrtc:android` to produce assets served by the Android WebRTC server.

## Signaling Protocol

The WebRTC client communicates with the Android NanoHTTPD server via HTTP endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Serve index.html |
| `/offer` | POST | Submit SDP offer |
| `/sdp` | GET | Poll for SDP answer |
| `/ice` | POST | Submit ICE candidates |
| `/status` | GET | Connection status |

DataChannel messages use JSON format:
- **Keyboard:** `{"type": "keyboard", "keysym": number, "down": boolean}`
- **Mouse:** `{"type": "mouse", "buttonMask": number, "x": number, "y": number, "pressed": boolean}`

See `packages/webrtc-core/src/protocol/signaling-protocol.ts` for TypeScript interfaces.

## License

MIT
