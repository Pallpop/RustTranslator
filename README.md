# RustTranslator - 轻量级翻译应用

基于 Rust + Tauri 构建的跨平台翻译应用，支持 macOS 和 Windows。

## 功能

- 菜单栏/系统托盘常驻
- 自动监听剪贴板，复制文本后自动翻译
- 使用 OpenAI 兼容 API（支持 OpenAI、DeepSeek、Moonshot 等）
- 项目管理：多个翻译项目，自定义 Prompt
- 术语表：自动提取专业术语，手动添加/删除
- 翻译记录保存

## 开发

### 环境要求

- Rust 1.70+
- Node.js 16+（可选，用于前端开发）
- Tauri CLI v2

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
cargo tauri dev
```

### 构建发布版

```bash
cargo tauri build
```

构建产物位于：
- macOS: `src-tauri/target/release/bundle/macos/`
- Windows: `src-tauri/target/release/bundle/msi/`

## 项目结构

```
RustTranslator/
├── src/                    # 前端文件
│   ├── index.html
│   ├── style.css
│   └── main.js
├── src-tauri/              # Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/       # Tauri v2 权限配置
│   ├── icons/              # 应用图标
│   └── src/
│       ├── main.rs         # 入口
│       ├── lib.rs          # Tauri 设置、命令
│       ├── translator.rs   # 翻译逻辑
│       └── glossary.rs     # 术语/项目管理
└── package.json
```

## 使用方法

1. 启动应用后，在设置中填写 API Key 和 Base URL
2. 复制文本后会自动翻译
3. 可在顶部切换项目，每个项目有独立的术语表
4. 非默认项目可自定义翻译 Prompt
