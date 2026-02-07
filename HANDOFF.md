# Secure Chat Project Handoff

**Date:** February 7, 2026
**Status:** Stable / Refactored

## Project Overview
A simple, robust WebSocket chat application with Admin controls and File Uploads.
The project was recently refactored from Fastify to **Express + WS** to resolve connection stability issues.

## Directory Structure
- `/root/secure-chat/server`: Node.js Backend (Express, ws, multer)
- `/root/secure-chat/client`: Vue 3 Frontend (Vite)

## Operational Guide

### 1. Start the Server
The server runs on Port 3000.
```bash
cd /root/secure-chat/server
nohup node index.js > server.log 2>&1 &
```

### 2. Build Frontend
If you make changes to `/client/src`:
```bash
cd /root/secure-chat/client
npm run build
```

### 3. Key Configurations
- **Server Entry**: `/server/index.js`
- **Config File**: `/server/config.json` (Stores Admin Password & Access Tokens)
- **Frontend App**: `/client/src/App.vue`

## Recent Changes & Fixes
- **Architecture**: Switched from Fastify to Express + `ws` library for better manual control over WebSocket upgrades.
- **Connection Logic**: 
  - Backend now manually parses URL parameters from the raw `upgrade` request.
  - Implemented Heartbeat (Ping/Pong) every 25s to prevent Code 1006 disconnects.
- **Security**: 
  - Simplified Auth: Admin Password + User Tokens (in URL).
  - Encrypted-to-Plaintext: Removed client-side E2EE in favor of standard transport (HTTP for now, assumes secure tunnel/VPN if needed).

## Known Issues / Notes
- The server currently runs in HTTP mode (Port 3000).
- If the chat window hangs, try refreshing to trigger the new "clean" connection logic.

---
*Generated for AI Context Handoff*
