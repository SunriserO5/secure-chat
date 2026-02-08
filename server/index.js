const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const configManager = require('./configManager');

// --- APP SETUP ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/dist')));

// --- STATE ---
const rooms = new Map(); // roomId -> Set<ws>
const adminSessions = new Set();
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// --- CONFIG MULTER ---
const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        cb(null, crypto.randomUUID() + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage, 
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// --- FILE CLEANUP TASK ---
setInterval(() => {
    const config = configManager.get();
    const retentionMs = (config.fileRetentionSeconds || 3600) * 1000;
    
    fs.readdir(uploadDir, (err, files) => {
        if (err) return console.error('[Cleanup] Read Dir Error:', err);
        
        const now = Date.now();
        let deletedCount = 0;
        
        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                
                if (now - stats.mtimeMs > retentionMs) {
                    fs.unlink(filePath, (err) => {
                        if (err) console.error(`[Cleanup] Failed to delete ${file}`);
                        else {
                            // console.log(`[Cleanup] Deleted ${file}`);
                            deletedCount++;
                        }
                    });
                }
            });
        });
        // Check done? Async nature makes counting hard here without promises, 
        // but for a simple periodic task it's fine to just let it run.
    });
}, 60 * 1000); // Check every minute

// --- HTTP ROUTES ---

// 1. File Upload
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({ fileId: req.file.filename });
});

// 2. File Download
app.get('/files/:fileId', (req, res) => {
    const filePath = path.join(uploadDir, req.params.fileId);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.sendFile(filePath);
});

// 3. Admin Login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const config = configManager.get();
    if (password === config.adminPassword) {
        const token = crypto.randomBytes(32).toString('hex');
        adminSessions.add(token);
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Failed' });
    }
});

// 4. Admin API (Get/Set Config)
app.get('/api/admin/config', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (!adminSessions.has(token)) return res.status(401).json({ error: 'Auth' });
    res.json(configManager.get());
});

// NEW: Public Config for Login Screen
app.get('/api/config/public', (req, res) => {
    const config = configManager.get();
    res.json({
        websiteName: config.websiteName || 'Secure Chat',
        chatOpen: config.chatOpen
    });
});

app.post('/api/admin/config', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (!adminSessions.has(token)) return res.status(401).json({ error: 'Auth' });
    
    // Save config
    const configPath = path.join(__dirname, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2));

    // BROACAST CONFIG UPDATES TO ALL CLIENTS
    // We need to reload config immediately in memory to broadcast accurate data
    // Assuming configManager watcher will pick it up, but for immediate response:
    const newConfig = req.body;
    
    // Also update the in-memory cache immediately to avoid race conditions
    // configManager might take 100ms via fs.watch
    // This is a bit hacky but ensures consistency until reload
    
    wss.clients.forEach(ws => {
        // Match by Room ID (more stable) or Token
        if (ws.roomId) {
            const roomConfig = newConfig.rooms.find(r => r.id === ws.roomId);
            if (roomConfig) {
                // KICK CHECK: If user is no longer in allowedUsers
                if (ws.username && roomConfig.allowedUsers) {
                    if (!roomConfig.allowedUsers.includes(ws.username)) {
                         console.log(`[Admin] Kicking removed user ${ws.username} from ${ws.roomId}`);
                         ws.send(JSON.stringify({ type: 'kick', reason: 'You have been removed from this room.' }));
                         ws.close();
                         return; // Stop processing this client
                    }
                }

                // Determine online count
                const roomData = rooms.get(ws.roomId);
                const count = roomData ? roomData.size : 0;
                
                try {
                    ws.send(JSON.stringify({
                        type: 'room-info',
                        websiteName: newConfig.websiteName || 'Secure Chat',
                        roomName: roomConfig.name,
                        status: roomConfig.status || 'active',
                        onlineCount: count
                    }));
                } catch(e) { console.error('Broadcast Error', e); }
            }
        }
    });

    res.json({ success: true });
});

app.post('/api/admin/change-password', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (!adminSessions.has(token)) return res.status(401).json({ error: 'Auth' });
    
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 1) return res.status(400).json({ error: 'Invalid password' });

    const config = configManager.get();
    config.adminPassword = newPassword;
    
    // Save
    const configPath = path.join(__dirname, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    res.json({ success: true });
});

app.post('/api/admin/clear-files', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (!adminSessions.has(token)) return res.status(401).json({ error: 'Auth' });

    fs.readdir(uploadDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Failed to read directory' });

        const deletePromises = files.map(file => {
            if (file === '.gitignore') return Promise.resolve();
            return new Promise((resolve) => {
                fs.unlink(path.join(uploadDir, file), () => resolve());
            });
        });

        Promise.all(deletePromises).then(() => {
            res.json({ success: true, message: 'Files cleared' });
        });
    });
});

// --- WEBSOCKET HANDLER (The "Raw" Logic) ---

// Handle Upgrade Manually to avoid framework magic hiding errors
server.on('upgrade', (request, socket, head) => {
    console.log('[UPGRADE] Request URL:', request.url);

    const config = configManager.get();
    
    // Parse URL manually from the raw request string
    // e.g. /ws?token=abc&room=123
    let query = {};
    try {
        const urlObj = new URL(request.url, 'http://localhost');
        if (urlObj.pathname !== '/ws') {
             socket.destroy();
             return;
        }
        query = Object.fromEntries(urlObj.searchParams);
    } catch (e) {
        console.error('[UPGRADE] Parse Error:', e);
        socket.destroy();
        return;
    }

    const { token, name, pubKey } = query;
    console.log(`[UPGRADE] Token: ${token}, Name: ${name}`);

    // Auth Check
    const targetRoom = (config.rooms || []).find(r => r.token === token);
    
    if (!targetRoom) {
        console.log('[UPGRADE] Invalid Token');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    // Validate Name
    // If allowedUsers is empty/undefined, maybe allow? For now strict as per request.
    const allowed = targetRoom.allowedUsers || [];
    if (!name || !allowed.includes(name)) {
        console.log(`[UPGRADE] User "${name}" not allowed in room "${targetRoom.name}"`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
    }

    if (config.chatOpen === false) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        // Attach metadata to the ws object
        ws.roomId = targetRoom.id;
        ws.roomToken = targetRoom.token;
        ws.username = name;
        ws.publicKey = pubKey; // Store User's Public Key
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws) => {
    const roomId = ws.roomId;
    console.log(`[WS] Client Connected to ${roomId}`);

    // KICK DUPLICATE USER
    if (rooms.has(roomId)) {
        const roomClients = rooms.get(roomId);
        for (const client of roomClients) {
            if (client !== ws && client.username === ws.username && client.readyState === WebSocket.OPEN) {
                console.log(`[WS] Kicking duplicate user ${ws.username} from room ${roomId}`);
                
                // Method 1: App Layer Kick (More Robust)
                client.send(JSON.stringify({ 
                    type: 'kick', 
                    reason: 'You have been logged in from another location.' 
                }));
                
                // Method 2: Protocol Layer Kick (Backup)
                setTimeout(() => {
                    try { client.close(4001, 'Duplicate Login'); } catch(e) {}
                }, 100);
            }
        }
    }

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);

    // --- SEND/BROADCAST ROOM INFO ---
    const config = configManager.get();
    const roomConfig = (config.rooms || []).find(r => r.id === roomId);
    const broadcastRoomInfo = () => {
        const clients = rooms.get(roomId);
        if (clients) {
            const info = JSON.stringify({
                type: 'room-info',
                websiteName: config.websiteName || 'Secure Chat',
                roomName: roomConfig ? roomConfig.name : 'Unknown',
                status: (roomConfig && roomConfig.status) ? roomConfig.status : 'active',
                onlineCount: clients.size
            });
            clients.forEach(c => {
                 if (c.readyState === WebSocket.OPEN) c.send(info);
            });
        }
    };
    broadcastRoomInfo();

    // Initial msg
    const roomDisplayName = roomConfig ? roomConfig.name : roomId;
    ws.send(JSON.stringify({ type: 'system', content: `Joined ${roomDisplayName}` }));

    // Send User List (with Public Keys) to the new user
    const userList = [];
    if (rooms.has(roomId)) {
        for (const client of rooms.get(roomId)) {
            if (client.readyState === WebSocket.OPEN && client.username) {
                userList.push({ username: client.username, publicKey: client.publicKey });
            }
        }
    }
    ws.send(JSON.stringify({ type: 'user_list', users: userList }));

    // Broadcast new user join to others
    const joinMsg = JSON.stringify({
        type: 'user_joined',
        username: ws.username,
        publicKey: ws.publicKey
    });
    
    // Broadcast helper
    const broadcast = (msg, excludeWs = null) => {
        const roomClients = rooms.get(roomId);
        if (roomClients) {
            for (const client of roomClients) {
                if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
                    client.send(msg);
                }
            }
        }
    };
    
    broadcast(joinMsg, ws);

    ws.on('message', (message) => {
        try {
            // Echo/Broadcast
            // We assume message is text; connection.socket.send accepts buffer/string
            const strMsg = message.toString();
            
            // Heartbeat check
            try {
                const parsed = JSON.parse(strMsg);
                if (parsed.type === 'ping') return; // Ignore ping
            } catch(e) {}

            const roomClients = rooms.get(roomId);
            if (roomClients) {
                for (const client of roomClients) {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(strMsg);
                    }
                }
            }
        } catch (e) {
            console.error('[WS] Broadcast Error:', e);
        }
    });

    ws.on('close', () => {
        console.log(`[WS] Client Disconnected from ${roomId}`);
        
        // Broadcast user left
        const leaveMsg = JSON.stringify({
            type: 'user_left',
            username: ws.username
        });
        
        const roomClients = rooms.get(roomId);
        if (roomClients) {
            roomClients.delete(ws);
            
            // Broadcast new count on leave
            const config = configManager.get();
            const roomConfig = (config.rooms || []).find(r => r.id === roomId);
             if (roomClients.size > 0 && roomConfig) { // Check if roomConfig exists
                const info = JSON.stringify({
                    type: 'room-info',
                    websiteName: config.websiteName || 'Secure Chat',
                    roomName: roomConfig ? roomConfig.name : 'Unknown',
                    status: (roomConfig && roomConfig.status) ? roomConfig.status : 'active',
                    onlineCount: roomClients.size
                });
                roomClients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN) c.send(info);
                });
            }
            if (roomClients.size === 0) rooms.delete(roomId);
            else {
                 for (const client of roomClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(leaveMsg);
                    }
                }
            }
        }
    });
});

// --- START ---
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server (Express+WS) listening on port ${PORT}`);
});
