# Secure Chat / 安全聊天应用

[English](#english) | [中文](#chinese)

---

<a name="english"></a>
## 🇬🇧 English

### Introduction
Secure Chat is a web-based, end-to-end encrypted chat application designed for privacy and security. It features ephemeral messaging, secure file sharing, and robust admin controls.

### Features
- **End-to-End Encryption**: Messages are encrypted on the client side using TweetNaCl before transmission.
- **Secure File Sharing**: Files are uploaded securely and automatically deleted after a configurable retention period.
- **Access Control**: Token-based room access with white-listed usernames.
- **Admin Panel**: Real-time configuration updates, user kicking, and system monitoring.
- **Responsive Design**: Optimized for both desktop and mobile devices.
- **"Remember Me"**: Optional local persistence for login credentials.

### Prerequisites
- Node.js (v18 or higher)
- npm (Node Package Manager)

### Installation

1.  **Clone the repository**
2.  **Install dependencies and initialize configuration**:
    ```bash
    npm run install-all
    npm run init-project
    ```
    *This command copies `server/config.example.json` to `server/config.json` and generates encryption keys.*

### Configuration
Edit `server/config.json` to set up your environment:
- `adminPassword`: Password for the admin panel (Default: CHANGE_THIS_PASSWORD).
- `rooms`: Define chat rooms, tokens, and allowed users.

### Usage

#### 1. Development Mode
Run client and server in separate terminals:
```bash
# Terminal 1: Frontend
npm run dev:client

# Terminal 2: Backend
npm run dev:server
```

#### 2. Production Build
1.  **Build the frontend**:
    ```bash
    npm run build:client
    ```
    *The build artifacts will be generated in `client/dist`.*

2.  **Start the server**:
    ```bash
    npm run start:server
    ```
    *The server will serve the built frontend files from port 3000 (or configured port).*

#### 3. Deployment (PM2 & Nginx)
For persistent deployment:
```bash
# Install PM2
npm install -g pm2

# Start Server
pm2 start server/index.js --name "secure-chat"
```

---

<a name="chinese"></a>
## 🇨🇳 中文

### 简介
Secure Chat 是一个基于 Web 的端到端加密聊天应用，专为隐私和安全设计。它具有阅后即焚、安全文件共享和强大的管理员控制功能。

### 功能特性
- **端到端加密**：消息在发送前使用 TweetNaCl 在客户端进行加密。
- **安全文件共享**：文件上传后会在配置的保留时间后自动删除。
- **访问控制**：基于令牌（Token）的房间访问控制和用户名白名单。
- **管理面板**：实时配置更新、踢出用户和系统监控。
- **响应式设计**：完美适配桌面和移动设备。
- **"记住我"功能**：可选择在本地保存登录凭据。

### 环境要求
- Node.js (v18 或更高版本)
- npm (Node Package Manager)

### 安装步骤

1.  **克隆仓库**
2.  **安装依赖并初始化配置**：
    ```bash
    npm run install-all
    npm run init-project
    ```
    *此命令会将 `server/config.example.json` 复制为 `server/config.json` 并生成所需的加密密钥。*

### 配置说明
编辑 `server/config.json` 进行个性化设置：
- `adminPassword`: 管理后台密码（默认：CHANGE_THIS_PASSWORD，请务必修改）。
- `rooms`: 定义聊天室、访问令牌和允许的用户列表。

### 使用方法

#### 1. 开发模式
在两个终端中分别运行前端和后端：
```bash
# 终端 1: 前端
npm run dev:client

# 终端 2: 后端
npm run dev:server
```

#### 2. 生产环境构建
1.  **构建前端资源**：
    ```bash
    npm run build:client
    ```
    *构建产物将生成在 `client/dist` 目录中。*

2.  **启动服务器**：
    ```bash
    npm run start:server
    ```
    *服务器将启动并在 3000 端口（或配置端口）托管前端页面。*

#### 3. 部署 (使用 PM2 和 Nginx)
如需长期在后台运行：
```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start server/index.js --name "secure-chat"
```

---
*Created by [Your Name/Team]*
