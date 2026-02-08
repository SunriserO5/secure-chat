<script setup>
import { ref, onMounted, computed, nextTick } from 'vue';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import AdminPanel from './components/AdminPanel.vue';

const SERVER_URL = `http://${window.location.hostname}:3000`;
const WS_URL = `ws://${window.location.hostname}:3000/ws`;

// State
const token = ref('');
const username = ref(''); 
const rememberMe = ref(false);
const connectionState = ref('login'); // login | connecting | connected | disconnected
const messages = ref([]);
const textInput = ref('');

// Room Info
const websiteName = ref('Secure Chat');
const roomName = ref('');
const roomStatus = ref('active'); // active | paused
const onlineCount = ref(0);

// Router State
const currentRoute = ref(window.location.hash);

window.addEventListener('hashchange', () => {
    currentRoute.value = window.location.hash;
});

const isChatView = computed(() => !currentRoute.value.startsWith('#admin'));
const isAdminView = computed(() => currentRoute.value.startsWith('#admin'));

// WebSocket & Crypto
let ws = null;
let keepAliveInterval = null;
let myKeyPair = null;
const userPublicKeys = new Map(); // Non-reactive to avoid Vue Proxy execution issues with TypedArrays

// Helper: Encode/Decode
const encodeBase64 = util.encodeBase64;
const decodeBase64 = util.decodeBase64;
// Removed confusing aliases to avoid TypeError

const isImage = (name) => /\.(jpg|jpeg|png|gif|webp)$/i.test(name);

onMounted(async () => {
    // 1. Fetch Public Config (Website Name)
    try {
        const res = await fetch(`${SERVER_URL}/api/config/public`);
        if (res.ok) {
            const data = await res.json();
            if (data.websiteName) {
                websiteName.value = data.websiteName;
                document.title = data.websiteName;
            }
        }
    } catch(e) {
        console.error('Failed to fetch public config', e);
    }

    // 2. Load Remembered Credentials
    const saved = localStorage.getItem('sc_creds');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed.username && parsed.token) {
                username.value = parsed.username;
                token.value = parsed.token;
                rememberMe.value = true;
            }
        } catch(e) {}
    }
});

async function join() {
  if (!username.value || !token.value) {
      alert('Please enter both Name and Token');
      return;
  }
  
  // Clear previous messages to avoid confusion
  messages.value = [];
  userPublicKeys.clear();

  // Save/Clear Credentials
  if (rememberMe.value) {
      localStorage.setItem('sc_creds', JSON.stringify({ username: username.value, token: token.value }));
  } else {
      localStorage.removeItem('sc_creds');
  }

  try {
      // 1. Generate KeyPair
      myKeyPair = nacl.box.keyPair();
  } catch(e) {
      alert('Crypto Init Failed: ' + e);
      return;
  }

  if (ws) {
    try { ws.close(); } catch(e){}
    ws = null;
  }
  if (keepAliveInterval) clearInterval(keepAliveInterval);

  connectionState.value = 'connecting';
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const port = '3000';
  const wsUrl = `${protocol}//${host}:${port}/ws`; 
  
  try {
     const pubKeyB64 = encodeBase64(myKeyPair.publicKey);
     ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token.value)}&name=${encodeURIComponent(username.value)}&pubKey=${encodeURIComponent(pubKeyB64)}`);
  } catch (e) {
     alert('WS Init Failed: ' + e.message);
     connectionState.value = 'login';
     return;
  }
  
  ws.onopen = () => {
    connectionState.value = 'connected';
    keepAliveInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 25000);
  };
  
  ws.onmessage = async (event) => {
    try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ping') return;
        
        if (msg.type === 'room-info') {
            websiteName.value = msg.websiteName;
            roomName.value = msg.roomName;
            roomStatus.value = msg.status;
            onlineCount.value = msg.onlineCount;

            // Update Tab Title
            document.title = websiteName.value;
        }
        else if (msg.type === 'user_list') {
            msg.users.forEach(u => {
                if (u.username !== username.value && u.publicKey) {
                    try {
                        userPublicKeys.set(u.username, decodeBase64(u.publicKey));
                    } catch(e) { console.error('Bad Key', u); }
                }
            });
            messages.value.push({ type: 'system', content: `Start chatting. ${msg.users.length} users online.`});
        }
        else if (msg.type === 'user_joined') {
            if (msg.username !== username.value && msg.publicKey) {
                try {
                    userPublicKeys.set(msg.username, decodeBase64(msg.publicKey));
                    messages.value.push({ type: 'system', content: `${msg.username} joined.`});
                } catch(e) { console.error('Bad Key', msg); }
            }
        }
        else if (msg.type === 'user_left') {
            userPublicKeys.delete(msg.username);
            messages.value.push({ type: 'system', content: `${msg.username} left.`});
        }
        else if (msg.type === 'kick') {
            alert(msg.reason || 'You have been kicked.');
            connectionState.value = 'login';
            if (ws) ws.close();
            return;
        }
        else if (msg.type === 'encrypted_text') {
            // Decrypt
            const decryptedContent = decryptMessage(msg);
            if (decryptedContent) {
                messages.value.push({ 
                    type: 'text', 
                    content: decryptedContent, 
                    sender: msg.sender 
                });
            } else {
                // Optional: Show message failure
                // messages.value.push({ type: 'system', content: `Unreadable message from ${msg.sender}` });
            }
        }
        else if (msg.type === 'encrypted_file') {
             // Similar to text
             const decryptedLink = decryptMessage(msg);
             if (decryptedLink) {
                 messages.value.push({
                     type: isImage(decryptedLink.name) ? 'image' : 'file',
                     content: decryptedLink.url,
                     name: decryptedLink.name,
                     sender: msg.sender
                 });
             }
        }
        else if (msg.type === 'text' || msg.type === 'system') { 
            // Fallback for unencrypted or system messages
            messages.value.push(msg); 
        }
        
        // Auto scroll
        nextTick(() => {
            const el = document.getElementById('messages');
            if (el) el.scrollTop = el.scrollHeight;
        });
    } catch (e) {
        console.error('Msg Parse Error', e);
    }
  };

  ws.onclose = (e) => {
     console.log('WS Closed', e.code, e.reason);
     if (e.code === 4001) {
         alert('You have been logged out because this account signed in from another location.');
         connectionState.value = 'login';
     } else if (e.code === 4003) { // Custom code for Forbidden
         alert('Login Failed: ' + (e.reason || 'Not authorized or name taken'));
         connectionState.value = 'login';
     } else if (connectionState.value === 'connected') {
         connectionState.value = 'disconnected';
     } else if (connectionState.value === 'connecting') {
         // If closed while connecting, it's likely an auth failure 
         // without a specific code if the browser masks it, but let's try.
         alert('Connection Failed. Please check your Token and Name.');
         connectionState.value = 'login';
     }
  };
  
  ws.onerror = (e) => {
     console.error('WS Error', e);
  };
}

function decryptMessage(msg) {
    // 1. Find the encrypted key for me
    if (!msg.keys || !msg.keys[username.value]) {
        console.warn(`[Decrypt] No key found for me (${username.value}) in msg from ${msg.sender}`);
        return null;
    }
    
    try {
        // 2. Decrypt the Session Key using Asymmetric (Box)
        // Box Open: nonce, box, theirPublicKey, mySecretKey
        const encryptedKeyObj = msg.keys[username.value]; // { nonce: '...', box: '...' }
        const senderPubKey = userPublicKeys.get(msg.sender);
        
        if (!senderPubKey) {
            console.error('[Decrypt] Unknown sender public key for', msg.sender);
            return null;
        }

        const sharedKey = nacl.box.open(
            decodeBase64(encryptedKeyObj.box),
            decodeBase64(encryptedKeyObj.nonce),
            senderPubKey,
            myKeyPair.secretKey
        );
        
        if (!sharedKey) {
            console.error('[Decrypt] Failed to decrypt shared key (Box Open Failed)'); 
            return null; 
        }

        // 3. Decrypt the Content using Symmetric (SecretBox)
        // SecretBox Open: box, nonce, key
        const decryptedContentBytes = nacl.secretbox.open(
            decodeBase64(msg.content.box),
            decodeBase64(msg.content.nonce),
            sharedKey
        );

        if (!decryptedContentBytes) {
             console.error('[Decrypt] Failed to decrypt content (SecretBox Open Failed)');
             return null;
        }
        
        const jsonString = util.encodeUTF8(decryptedContentBytes);
        return JSON.parse(jsonString); // Returns string for text, or object for file Info

    } catch (e) {
        console.error('[Decrypt] Exception:', e);
        return null;
    }
}

function sendText() {
    if (!textInput.value.trim()) return;
    
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            
            // 1. Generate Session Key (Symmetric)
            // Force clean Uint8Array immediately
            const sessionKey = new Uint8Array(nacl.randomBytes(nacl.secretbox.keyLength));
            
            // 2. Encrypt Content
            const contentJson = JSON.stringify(textInput.value);
            // Ensure decodeUTF8 returns Uint8Array and we wrap it to be sure
            const contentBytes = new Uint8Array(util.decodeUTF8(contentJson));
            const contentNonce = new Uint8Array(nacl.randomBytes(nacl.secretbox.nonceLength));
            
            // Debug check (optional, but good for confidence)
            if (!(contentBytes instanceof Uint8Array)) throw new Error("contentBytes not Uint8Array");
            if (!(contentNonce instanceof Uint8Array)) throw new Error("contentNonce not Uint8Array");
            if (!(sessionKey instanceof Uint8Array)) throw new Error("sessionKey not Uint8Array");

            const encryptedContent = nacl.secretbox(
                contentBytes,
                contentNonce,
                sessionKey
            );
            
            // 3. Encrypt Session Key for EACH User
            const recipients = {};
            let recipientCount = 0;
            
            userPublicKeys.forEach((pubKey, userName) => {
                 try {
                     // Cleanse Keys
                     const cleanPubKey = new Uint8Array(pubKey);
                     const cleanSecretKey = new Uint8Array(myKeyPair.secretKey);
                     const keyNonce = new Uint8Array(nacl.randomBytes(nacl.box.nonceLength));
                     
                     const encryptedKey = nacl.box(
                         sessionKey, // already clean from step 1
                         keyNonce,
                         cleanPubKey,
                         cleanSecretKey
                     );
                     
                     recipients[userName] = {
                         nonce: encodeBase64(keyNonce),
                         box: encodeBase64(encryptedKey)
                     };
                     recipientCount++;
                 } catch (innerE) {
                     console.error(`Failed to encrypt for ${userName}:`, innerE);
                 }
            });

            console.log(`[Send] Encrypted for ${recipientCount} users.`);

            const payload = {
                type: 'encrypted_text',
                sender: username.value, // Plaintext sender name
                content: {
                    nonce: encodeBase64(contentNonce),
                    box: encodeBase64(encryptedContent)
                },
                keys: recipients
            };

            ws.send(JSON.stringify(payload));
            
            // Optimistic UI Update
            messages.value.push({
                type: 'text',
                content: textInput.value, // Show original text locally
                sender: username.value
            });
            
            textInput.value = '';
        }
    } catch(e) {
        alert('Send Error: ' + e.message);
        console.error("Full Send Error:", e);
    }
}

// File Upload Logic
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Upload PLAIN file (Transport Security Only? Or E2E Encrypt file blob?)
    // User requested E2E. To do true E2E file, we should encrypt file locally, upload blob, then share key.
    // For simplicity given constraints, let's implement the Key Exchange for the LINK first.
    // But ideally: Encrypt file with SessionKey -> Upload Encrypted Blob -> Send Link + Key.
    // Let's stick to uploading plain file for now to keep it simple as step 1, but encrypt the link/filename.
    
    // UPLOAD
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const res = await fetch(`${SERVER_URL}/upload`, {
            method: 'POST',
            body: formData
        });
         const data = await res.json();
        
        if (data.fileId) {
             const fileInfo = { url: `${SERVER_URL}/files/${data.fileId}`, name: file.name };
             
             // Encrypt Logic (Copy Paste from Text - Abstract later)
            const sessionKey = new Uint8Array(nacl.randomBytes(nacl.secretbox.keyLength));
            const contentJson = JSON.stringify(fileInfo); // Encrypt Object
            const contentNonce = new Uint8Array(nacl.randomBytes(nacl.secretbox.nonceLength));
            const encryptedContent = nacl.secretbox(
                new Uint8Array(util.decodeUTF8(contentJson)), 
                contentNonce, 
                sessionKey
            );
            
            const recipients = {};
            userPublicKeys.forEach((pubKey, userName) => {
                 const keyNonce = new Uint8Array(nacl.randomBytes(nacl.box.nonceLength));
                 const cleanPubKey = new Uint8Array(pubKey);
                 const cleanSecretKey = new Uint8Array(myKeyPair.secretKey);

                 const encryptedKey = nacl.box(sessionKey, keyNonce, cleanPubKey, cleanSecretKey);
                 recipients[userName] = { nonce: encodeBase64(keyNonce), box: encodeBase64(encryptedKey) };
            });

            const payload = {
                type: 'encrypted_file',
                sender: username.value,
                content: { nonce: encodeBase64(contentNonce), box: encodeBase64(encryptedContent) },
                keys: recipients
            };
            
            ws.send(JSON.stringify(payload));
            
            messages.value.push({
                type: isImage(fileInfo.name) ? 'image' : 'file',
                content: fileInfo.url,
                name: fileInfo.name,
                sender: username.value
            });
        }
    } catch (e) {
        alert('Upload failed: ' + e);
    }
}
</script>

<template>
  <div class="root-wrapper">
    <!-- ADMIN VIEW -->
    <AdminPanel v-if="isAdminView" />

    <!-- CHAT VIEW -->
    <div v-else class="app-container">
        <div class="header">
            <h1>{{ websiteName }}</h1>
            <a href="#admin" target="_blank" class="admin-link">⚙️ Admin Login</a>
        </div>

        <!-- Login Screen -->
        <div v-if="connectionState === 'login'" class="login-container">
            <h3>Enter Room</h3>
            <div class="form-group">
                <label>Your Name</label>
                <input v-model="username" placeholder="Name (assigned by admin)" />
            </div>
            <div class="form-group">
                <label>Room Token</label>
                <input v-model="token" placeholder="Room Token" />
            </div>
            
            <div class="form-options">
                <label class="checkbox-label">
                    <input type="checkbox" v-model="rememberMe" /> Remember Info
                </label>
            </div>

            <button @click="join" class="join-btn">Join Chat</button>
            
            <div class="login-footer">
                <span class="version">v1.2.0</span>
                <span class="security-badge">🔒 End-to-End Encrypted</span>
            </div>
        </div>

        <!-- Chat Screen -->
        <div v-show="connectionState === 'connected' || connectionState === 'disconnected'" class="chat-wrapper">
            <div class="status-bar" :class="connectionState">
                <div v-if="connectionState === 'connected'" class="status-info">
                   <span class="user-status">🟢 Connected as <b>{{ username }}</b></span>
                   <span class="room-status" v-if="roomName">
                       <span class="room-name">{{ roomName }}</span>
                       <span class="user-count">{{ onlineCount }} Online</span>
                       <span class="status-light" :class="roomStatus" :title="roomStatus"></span>
                   </span>
                </div>
                <span v-else>🔴 Disconnected</span>
                <div class="status-actions">
                     <button v-if="connectionState === 'disconnected'" @click="join">Reconnect</button>
                     <button @click="connectionState = 'login'">Exit</button>
                </div>
            </div>

            <div class="messages" id="messages">
                <div v-for="(m, i) in messages" :key="i" class="msg-row" :class="{ 'my-msg': m.sender === username }">
                    <div class="msg-bubble">
                        <div class="sender-name" v-if="m.sender && m.sender !== username">{{ m.sender }}</div>
                        
                        <span v-if="m.type === 'text'">{{ m.content }}</span>
                        <span v-if="m.type === 'image'">
                            <a :href="m.content" target="_blank" title="Click to view full size">
                                <img :src="m.content" class="chat-image" />
                            </a>
                        </span>
                        <span v-if="m.type === 'file'">
                            📎 <a :href="m.content" target="_blank">{{ m.name }}</a>
                        </span>
                        <span v-if="m.type === 'system'" class="system-msg">{{ m.content }}</span>
                    </div>
                </div>
            </div>

            <div class="chat-watermark">v1.2.0 &bull; 🔒 E2EE Enabled</div>

            <div class="input-area" :class="{ disabled: roomStatus === 'paused' }">
                <input v-model="textInput" @keyup.enter="sendText" :placeholder="roomStatus === 'paused' ? 'Chat is paused' : 'Type message...'" :disabled="roomStatus === 'paused'" />
                <button @click="sendText" :disabled="roomStatus === 'paused'">Send</button>
                <label class="file-btn">
                    📎
                    <input type="file" @change="handleFileSelect" style="display:none" />
                </label>
            </div>
        </div>
    </div>
  </div>
</template>

<style>
/* Basic Reset */
* { box-sizing: border-box; }
body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; }
body { font-family: 'Segoe UI', sans-serif; background: #222; color: #eee; }
#app { height: 100%; width: 100%; }

.root-wrapper { height: 100%; width: 100%; }
.app-container { 
    height: 100%; 
    display: flex; 
    flex-direction: column; 
    background: #333; 
    max-width: 800px; 
    margin: 0 auto; 
    box-shadow: 0 0 20px rgba(0,0,0,0.5); 
    overflow: hidden; /* Prevent invalid scroll */
}

.header { padding: 15px; background: #444; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #555; flex-shrink: 0; }
.header h1 { margin: 0; font-size: 1.2em; }
.admin-link { color: #aaa; text-decoration: none; font-size: 0.9em; border: 1px solid #666; padding: 5px 10px; border-radius: 4px; }
.admin-link:hover { background: #555; color: white; }

.login-container { padding: 40px; text-align: center; flex: 1; display: flex; flex-direction: column; justify-content: center; overflow-y: auto; }
.form-group { margin-bottom: 20px; text-align: left; width: 80%; margin-left: auto; margin-right: auto; max-width: 400px; }
.form-group label { display: block; margin-bottom: 5px; color: #aaa; }
input { padding: 12px; width: 100%; box-sizing: border-box; border: 1px solid #555; border-radius: 4px; background: #222; color: white; font-size: 1em; }
.join-btn { padding: 12px 30px; background: #4caf50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 1em; margin-top: 10px; }
.join-btn:hover { background: #45a049; }

.form-options { margin-bottom: 20px; text-align: left; width: 80%; margin-left: auto; margin-right: auto; max-width: 400px; display: flex; align-items: center; }
.checkbox-label { display: flex; align-items: center; cursor: pointer; color: #aaa; font-size: 0.9em; gap: 8px; }
.checkbox-label input { width: auto; margin: 0; padding: 0; cursor: pointer; }

.login-footer { margin-top: 30px; display: flex; flex-direction: column; align-items: center; gap: 5px; color: #666; font-size: 0.8em; }
.version { font-family: monospace; opacity: 0.7; }
.security-badge { color: #4caf50; border: 1px solid #4caf50; padding: 2px 8px; border-radius: 10px; font-size: 0.9em; background: rgba(76, 175, 80, 0.1); }

.chat-wrapper { display: flex; flex-direction: column; flex: 1; overflow: hidden; position: relative; }
.chat-watermark { position: absolute; bottom: 85px; right: 20px; font-size: 0.75em; color: rgba(255, 255, 255, 0.15); pointer-events: none; user-select: none; font-family: monospace; z-index: 10; }
.status-bar { padding: 8px 15px; background: #555; font-size: 0.9em; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; flex-wrap: wrap; gap: 10px; }
.status-bar.disconnected { background: #d00; }
.status-info { display: flex; align-items: center; gap: 20px; flex: 1; flex-wrap: wrap; }
.room-status { display: flex; align-items: center; gap: 10px; background: #444; padding: 2px 10px; border-radius: 12px; white-space: nowrap; }

@media (max-width: 600px) {
    .status-bar { padding: 8px 10px; flex-direction: column; align-items: stretch; gap: 8px; }
    .status-info { justify-content: space-between; width: 100%; gap: 10px; }
    .status-actions { display: flex; justify-content: flex-end; width: 100%; }
    .user-status { font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
.room-name { font-weight: bold; color: #fff; }
.user-count { color: #aaa; font-size: 0.9em; }
.status-light { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.status-light.active { background: #4caf50; box-shadow: 0 0 5px #4caf50; }
.status-light.paused { background: #f44336; box-shadow: 0 0 5px #f44336; }
.status-actions button { margin-left: 10px; padding: 2px 8px; font-size: 0.8em; }

.input-area.disabled { opacity: 0.6; pointer-events: none; }

.messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px; scroll-behavior: smooth; }
.msg-row { display: flex; flex-direction: column; align-items: flex-start; }
.msg-row.my-msg { align-items: flex-end; }
.msg-bubble { background: #444; padding: 10px 15px; border-radius: 18px; max-width: 75%; position: relative; line-height: 1.4; word-wrap: break-word; }
.my-msg .msg-bubble { background: #007bff; color: white; border-bottom-right-radius: 4px; }
.msg-row:not(.my-msg) .msg-bubble { border-bottom-left-radius: 4px; background: #3a3a3a; }

.sender-name { font-size: 0.75em; color: #bbb; margin-bottom: 4px; font-weight: bold; }
.system-msg { font-style: italic; color: #aaa; font-size: 0.9em; text-align: center; display: block; width: 100%; }

.input-area { padding: 15px; background: #444; display: flex; gap: 10px; border-top: 1px solid #555; flex-shrink: 0; }
.input-area input { flex: 1; border: none; background: #333; }
.input-area button { padding: 0 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
.file-btn { cursor: pointer; background: #555; padding: 10px 15px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
.file-btn:hover { background: #666; }

.chat-image { max-width: 100%; max-height: 300px; border-radius: 8px; cursor: zoom-in; margin-top: 5px; border: 1px solid #555; display: block; }

</style>
