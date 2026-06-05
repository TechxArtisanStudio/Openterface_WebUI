# Openterface WebUI

Shared WebRTC client components and application for Openterface KVM.

## Overview

This repository contains:

- **`@openterface/control-ui`** - Reusable Vue UI components (Layout, VideoStream, etc.)
- **`@openterface/webrtc-core`** - WebRTC transport logic with HID protocol translation
- **`@openterface/webrtc`** - WebRTC client application (Android-compatible)

## Usage

### As a Submodule (Android)

Android uses this repo as a git submodule and builds the web client:

```bash
cd packages/webrtc
npm install
npm run build
# Output: dist/webrtc-android/
```

### As a Submodule (Web)

Openterface_Web references this repo to share the UI components:

```bash
cd Openterface_Web
git submodule update --init
cd submodules/Openterface_WebUI
npm install
```

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
npm install
```

### Type Checking

```bash
npm run typecheck
```

### Build WebRTC for Android

```bash
npm run build:webrtc:android
```

### Dev Server

```bash
npm -w @openterface/webrtc run dev
```

## Dependencies

This repository depends on `@openterface/core` from npm. For local development when core is not yet published:

1. Use `npm link` to link a local build of core
2. Or set up a local npm registry

## Architecture

```
WebUI
├── control-ui          ← Vue UI components (USB & WebRTC share this)
│   └── depends on: @openterface/core
├── webrtc-core         ← WebRTC transport + CH9329→JSON translation
│   └── depends on: @openterface/core
└── webrtc              ← WebRTC client app
    └── depends on: control-ui, webrtc-core
```

## License

Copyright © 2025 TechxArtisan
