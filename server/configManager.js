/* server/configManager.js */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
let configCache = null;

function loadConfig() {
  try {
    const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
    configCache = JSON.parse(fileContent);
    console.log(`[Config] Loaded/Reloaded at ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error('[Config] Failed to load config:', error.message);
  }
}

// 初始加载
loadConfig();

// 监听文件变化 (带防抖)
let debounceTimer;
fs.watch(CONFIG_PATH, (eventType, filename) => {
  if (eventType === 'change') {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      loadConfig();
    }, 100);
  }
});

module.exports = {
  get: () => configCache
};
