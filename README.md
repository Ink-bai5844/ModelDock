# ModelDock

ModelDock 是一个用于统一连接、管理和调用多种 AI API 的多账号聊天工作台。它提供模型目录、API 端点、自定义请求映射、多模态附件、深度思考过程、会话历史和主题外观等完整界面。

## 主要功能

- OpenAI Compatible、Anthropic、Gemini、Ollama 与自定义请求格式适配
- 文本、图像、视频、音频输入及模型生成媒体的预览与保存
- 可搜索、分页和批量管理的聊天记录
- 可维护、分组和拖动排序的模型目录与 API 端点
- 可复用的图片生成/编辑请求模板与自定义字段映射
- 支持推理模型的深度思考开关、过程流式显示和 Markdown/GFM 渲染
- 多账号注册登录，账号配置、会话和界面偏好彼此独立
- 本地文件存储模式，以及用于服务器部署的 MySQL 存储实现
- 浅色/深色模式、多套主题色和可调节的背景交互效果
- 独立管理员入口，可管理普通账号

## 技术栈

- React 19 + TypeScript + Vite
- Node.js + TypeScript
- MySQL 兼容存储（`mysql2`）或本地文件存储
- Node.js 内置测试运行器

## 本地运行

建议使用 Node.js 24 和 pnpm。

```powershell
Copy-Item config.example.json config.json
pnpm install
pnpm dev
```

如果 PowerShell 中尚未启用 pnpm，可以先运行：

```powershell
corepack enable
corepack prepare pnpm@latest --activate
```

开发环境默认地址：

- Web：`http://127.0.0.1:4173`
- API：`http://127.0.0.1:3000`
- 管理入口：`http://127.0.0.1:4173/admin`

## 配置

复制 `config.example.json` 为 `config.json` 后按环境修改。`config.json`、`data/`、部署包、日志和环境变量文件均被 Git 忽略。

- `onlineMode: false`：账号与工作区数据保存在本地 `data/` 目录
- `onlineMode: true`：使用 MySQL 存储，并通过 `MODELDOCK_MYSQL_PASSWORD` 提供数据库密码
- `adminUsername`：指定唯一管理员账号名
- `server.allowedOrigins`：设置允许访问 API 的前端来源

请勿把真实 API Key、数据库密码、账号数据或生产环境配置提交到版本库。

## 构建与测试

```powershell
pnpm test
pnpm build
pnpm start
```

`pnpm build` 会生成前端 `dist/` 和服务端 `dist-server/`，两者都不会提交到仓库。

## 说明

本仓库未附带开源许可证。公开可见不代表自动授予复制、修改或分发权限。

