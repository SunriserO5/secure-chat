<script setup>
import { ref, onMounted } from 'vue';

const SERVER_URL = `http://${window.location.hostname}:3000`; // Adjust if behind proxy

const password = ref('');
const isAuthenticated = ref(false);
const errorMsg = ref('');
const config = ref(null);
const adminToken = ref('');

// Password Change State
const newPassword = ref('');
const confirmPassword = ref('');

const activeTab = ref('general'); // general | rooms | maintenance
const newUserInputs = ref({}); // Index -> String

async function changePassword() {
    if (!newPassword.value) return alert('Please enter a new password');
    if (newPassword.value !== confirmPassword.value) return alert('Passwords do not match');
    
    try {
        const res = await fetch(`${SERVER_URL}/api/admin/change-password`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-admin-token': adminToken.value 
            },
            body: JSON.stringify({ newPassword: newPassword.value })
        });
        
        const data = await res.json();
        if (data.success) {
            alert('Password changed successfully. Please login again.');
            logout();
        } else {
            alert('Error: ' + data.error);
        }
    } catch(e) {
        alert('Request failed: ' + e);
    }
}

async function login() {
    try {
        const res = await fetch(`${SERVER_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password.value })
        });
        const data = await res.json();
        if (data.token) {
            adminToken.value = data.token;
            isAuthenticated.value = true;
            fetchConfig();
        } else {
            errorMsg.value = 'Login Failed';
        }
    } catch (e) {
        errorMsg.value = 'Error: ' + e;
    }
}

function logout() {
    isAuthenticated.value = false;
    password.value = '';
    adminToken.value = '';
    config.value = null;
}

async function fetchConfig() {
    try {
        const res = await fetch(`${SERVER_URL}/api/admin/config`, {
            headers: { 'x-admin-token': adminToken.value }
        });
        if (res.status === 401) { logout(); return; }
        config.value = await res.json();
        // Defaults
        if(!config.value.websiteName) config.value.websiteName = 'Secure Chat';
        if(config.value.rooms) config.value.rooms.forEach(r => { if(!r.status) r.status = 'active'; });
    } catch (e) {
        alert('Failed to load config');
    }
}

async function saveConfig() {
    try {
        const res = await fetch(`${SERVER_URL}/api/admin/config`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-admin-token': adminToken.value 
            },
            body: JSON.stringify(config.value)
        });
        if (res.ok) {
            alert('Saved & Broadcasted!');
        } else {
            alert('Save failed');
        }
    } catch (e) {
        alert('Error saving: ' + e);
    }
}

async function clearFiles() {
    if(!confirm('Are you sure you want to delete ALL uploaded files? This cannot be undone.')) return;
    try {
        const res = await fetch(`${SERVER_URL}/api/admin/clear-files`, {
            method: 'POST',
            headers: { 'x-admin-token': adminToken.value }
        });
        const data = await res.json();
        if (data.success) alert(data.message);
        else alert('Failed: ' + data.error);
    } catch(e) {
        alert('Error: ' + e);
    }
}

// Room Management
function addRoom() {
    config.value.rooms.push({
        id: 'room-' + Date.now() + '-' + Math.floor(Math.random()*1000),
        name: 'New Room',
        token: 'token-' + Math.floor(Math.random()*10000),
        allowedUsers: [],
        status: 'active'
    });
}
function removeRoom(index) {
    if(confirm('Delete room?')) config.value.rooms.splice(index, 1);
}
function addUser(roomIndex) {
    const name = newUserInputs.value[roomIndex];
    if (name) {
        if (!config.value.rooms[roomIndex].allowedUsers) config.value.rooms[roomIndex].allowedUsers = [];
        config.value.rooms[roomIndex].allowedUsers.push(name);
        newUserInputs.value[roomIndex] = '';
    }
}
function removeUser(roomIndex, userIndex) {
    config.value.rooms[roomIndex].allowedUsers.splice(userIndex, 1);
}
</script>

<template>
  <div class="admin-wrapper">
    <!-- Unauthenticated View -->
    <div v-if="!isAuthenticated" class="login-box">
      <h2>Admin Login</h2>
      <input type="password" v-model="password" placeholder="Password" @keyup.enter="login" />
      <button @click="login">Login</button>
      <p class="error">{{ errorMsg }}</p>
    </div>

    <!-- Dashboard View -->
    <div v-else class="dashboard">
      <!-- Sidebar -->
      <div class="sidebar">
          <h3>Admin Panel</h3>
          <button :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">General</button>
          <button :class="{ active: activeTab === 'rooms' }" @click="activeTab = 'rooms'">Rooms</button>
          <button :class="{ active: activeTab === 'maintenance' }" @click="activeTab = 'maintenance'">Maintenance</button>
          <div class="spacer"></div>
          <button @click="saveConfig" class="save-btn">Save Changes</button>
          <button @click="logout" class="logout-btn">Logout</button>
      </div>

      <!-- Main Content -->
      <div class="content">
          <!-- General Tab -->
          <div v-if="activeTab === 'general'">
              <h2>General Settings</h2>
              <div class="card">
                  <div class="field">
                      <label>Website Name</label>
                      <input v-model="config.websiteName" placeholder="Secure Chat" />
                  </div>
                  <div class="field">
                      <label>Server Port (Read-only)</label>
                      <input :value="config.serverPort" disabled />
                  </div>
                  <div class="field">
                      <label>Global Chat Open</label>
                      <input type="checkbox" v-model="config.chatOpen" />
                  </div>
              </div>

              <h3>Admin Security</h3>
              <div class="card">
                  <div class="field">
                      <label>New Password</label>
                      <input v-model="newPassword" type="password" />
                  </div>
                  <div class="field">
                      <label>Confirm Password</label>
                      <input v-model="confirmPassword" type="password" />
                  </div>
                  <button @click="changePassword">Update Password</button>
              </div>
          </div>

          <!-- Rooms Tab -->
          <div v-if="activeTab === 'rooms'">
              <div class="tab-header">
                <h2>Rooms Management</h2>
                <button @click="addRoom" class="add-btn">+ New Room</button>
              </div>
              
              <div class="rooms-grid">
                  <div v-for="(room, index) in config.rooms" :key="index" class="room-card" :class="{ paused: room.status === 'paused' }">
                      <div class="room-header">
                          <input v-model="room.name" class="room-name-input" />
                          <div class="room-actions">
                             <select v-model="room.status">
                                 <option value="active">Active</option>
                                 <option value="paused">Paused</option>
                             </select>
                             <button @click="removeRoom(index)" class="del-btn">Del</button>
                          </div>
                      </div>
                      <div class="room-body">
                          <div class="field-sm">
                              <label>Token:</label>
                              <input v-model="room.token" />
                          </div>
                          
                          <div class="users-section">
                              <label>Allowed Users:</label>
                              <div class="tags">
                                  <span v-for="(user, uIndex) in room.allowedUsers" :key="uIndex" class="tag">
                                      {{ user }}
                                      <b @click="removeUser(index, uIndex)">x</b>
                                  </span>
                              </div>
                              <div class="add-user-row">
                                  <input v-model="newUserInputs[index]" placeholder="Add User..." @keyup.enter="addUser(index)" />
                                  <button @click="addUser(index)">+</button>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>

          <!-- Maintenance Tab -->
          <div v-if="activeTab === 'maintenance'">
              <h2>Maintenance</h2>
              <div class="card">
                  <h3>File Storage</h3>
                  <p>Clear all uploaded files from the server. This action cannot be undone.</p>
                  <button @click="clearFiles" class="danger-btn">🗑️ Clear All Uploads</button>
              </div>
          </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-wrapper { display: flex; height: 100vh; background: #222; color: #eee; }
.login-box { margin: auto; text-align: center; padding: 40px; background: #333; border-radius: 8px; }
.login-box input { padding: 10px; margin-bottom: 10px; display: block; width: 200px; }
.login-box button { padding: 10px 20px; cursor: pointer; }

.dashboard { display: flex; width: 100%; }
.sidebar { width: 200px; background: #333; padding: 20px; display: flex; flex-direction: column; gap: 10px; border-right: 1px solid #444; }
.sidebar h3 { margin-top: 0; color: #aaa; font-size: 0.9em; text-transform: uppercase; }
.sidebar button { text-align: left; padding: 10px; background: transparent; border: none; color: #ccc; cursor: pointer; border-radius: 4px; }
.sidebar button:hover { background: #444; }
.sidebar button.active { background: #007bff; color: white; }
.sidebar .spacer { flex: 1; }
.sidebar .save-btn { background: #4caf50; color: white; text-align: center; font-weight: bold; }
.sidebar .logout-btn { text-align: center; border: 1px solid #555; }

.content { flex: 1; padding: 30px; overflow-y: auto; background: #2a2a2a; }
.card { background: #333; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
.field { margin-bottom: 15px; }
.field label { display: block; margin-bottom: 5px; color: #aaa; }
.field input { width: 100%; padding: 8px; background: #222; border: 1px solid #444; color: white; border-radius: 4px; }

.rooms-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
.room-card { background: #333; border-radius: 8px; padding: 15px; border: 1px solid #444; }
.room-card.paused { border-color: #f44336; opacity: 0.9; }
.room-header { display: flex; justify-content: space-between; margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px; }
.room-name-input { font-weight: bold; background: transparent; border: none; color: white; font-size: 1.1em; width: 120px; }
.room-actions { display: flex; gap: 5px; }
.room-actions select { background: #222; color: white; border: 1px solid #555; border-radius: 4px; }
.del-btn { background: #d00; color: white; border: none; padding: 2px 8px; border-radius: 4px; cursor: pointer; }

.field-sm { margin-bottom: 10px; display: flex; gap: 10px; align-items: center; }
.field-sm input { background: #222; border: 1px solid #444; color: #aaa; padding: 4px; flex: 1; font-family: monospace; }

.users-section { margin-top: 10px; }
.tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
.tag { background: #444; padding: 2px 8px; border-radius: 10px; font-size: 0.9em; display: flex; align-items: center; gap: 5px; }
.tag b { cursor: pointer; color: #ff6b6b; }
.add-user-row { display: flex; gap: 5px; }
.add-user-row input { flex: 1; padding: 5px; background: #222; border: 1px solid #444; color: white; }

.tab-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.add-btn { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
.danger-btn { background: #d00; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
</style>
