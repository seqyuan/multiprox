# MultiProx

**一台 Linux 服务器，一个 Web 入口，每人管理自己的 Jupyter / RStudio / 内网服务。**

MultiProx 是面向实验室、登录节点的**多用户认证反向代理**：志愿者启动一个共享网关，普通用户用 **SSH 终端 CLI** 管理转发，登录网页后点击卡片统一访问，无需每人记不同端口。

<p align="center">
  <img src="docs/images/multiprox-preview.png" alt="MultiProx 登录页与仪表盘示例" width="720">
</p>

<p align="center"><sub>网页端示例：登录 → 只读仪表盘点击访问服务；添加/排序在 SSH 终端用 CLI</sub></p>

---

## 这是什么？

假设服务器 `lab.example.com` 上有三个用户，各自跑着不同服务：

| 用户 | 本机服务 | 原始地址（仅本机可访问） |
|------|----------|--------------------------|
| alice | Jupyter Lab | `127.0.0.1:1901` |
| alice | RStudio | `127.0.0.1:8787` |
| bob | VS Code Server | `127.0.0.1:8080` |
| bob | 内网 GPU 节点 | `192.168.0.109:1901` |

**没有 MultiProx**：每人要记住端口，或找管理员改 nginx。

**有了 MultiProx**：统一从 `http://lab.example.com:1907` 登录，点击卡片即可访问：

```text
http://lab.example.com:1907/proxy/alice/jupyter/
http://lab.example.com:1907/proxy/alice/rstudio/
http://lab.example.com:1907/proxy/bob/vscode/
http://lab.example.com:1907/proxy/bob/gpu-node/
```

---

## 网页端长什么样？

### 登录页

```text
┌─────────────────────────────────────┐
│                          [ 🌙 ]     │
│            MultiProx                │
│      多服务认证反向代理入口          │
│                                     │
│  用户名  [ alice              ]     │
│  密码    [ ••••••••           ]     │
│                                     │
│         [      登 录      ]         │
└─────────────────────────────────────┘
```

### 仪表盘（登录后，只读）

```text
┌──────────────────────────────────────────────────────────┐
│ MultiProx · alice                           [ 🌙 ] [退出] │
├──────────────────────────────────────────────────────────┤
│ 添加/删除/排序请在 SSH 终端：multiprox add / layout      │
│                                                          │
│ 开发工具                                                  │
│ ┌─────────────────┐  ┌─────────────────┐               │
│ │ 🔗 jupyter      │  │ 🔗 rstudio      │  ← 点击访问   │
│ │ 交互式笔记本     │  │ R 语言环境       │               │
│ │ 127.0.0.1:1901  │  │ 127.0.0.1:8787  │               │
│ └─────────────────┘  └─────────────────┘               │
└──────────────────────────────────────────────────────────┘
```

### 终端添加（`multiprox add`）

```text
$ multiprox add

MultiProx 添加端口转发（直接回车采用默认值）

名称 (必填): jupyter
说明 []: 交互式笔记本
后端地址 [127.0.0.1]:
端口 (必填): 1901
分类 []: 开发工具
启用 WebSocket [y/N]: n

将添加: jupyter -> 127.0.0.1:1901  路径 /jupyter
确认添加 [Y/n]:
[multiprox] added jupyter -> 127.0.0.1:1901 at /jupyter
```

一行命令仍可用：`multiprox add --port 1901 jupyter 说明`

### 终端布局（`multiprox layout`）

```text
MultiProx 布局编辑（添加/删除请用 multiprox add / remove）

 1  jupyter       开发工具    127.0.0.1:1901
 2  rstudio       开发工具    127.0.0.1:8787
 3  gpu-node      未分类      192.168.0.109:1901

命令: <序号>u 上移 | <序号>d 下移 | <序号>c <分类> 改分类 | s 保存 | q 退出
> 3u
> s
[multiprox] layout saved
```

CLI 写入 `~/.config/multiprox/config.yaml`，改完约 10 秒内自动生效。

---

## 工作流程

```mermaid
flowchart LR
  A[志愿者启动 multiprox] --> B[用户 multiprox passwd]
  B --> C[CLI add / remove / layout]
  C --> D[写入 config.yaml]
  D --> E[daemon 扫描加载]
  E --> F[浏览器登录访问 /proxy/用户/服务/]
```

---

## 一分钟上手

```bash
# ① 志愿者：启动网关（一次）
multiprox

# ② 用户 alice：设密码
multiprox passwd

# ③ 添加转发（SSH 终端，交互式）
multiprox add
multiprox layout    # 可选：调整顺序与分类

# ④ 浏览器打开
# http://lab.example.com:1907/  →  登录 alice  →  点击 jupyter 卡片
```

**终端输出示例：**

```text
$ multiprox add --port 1901 jupyter 交互式笔记本
[multiprox] added jupyter -> 127.0.0.1:1901 at /jupyter

$ multiprox list
jupyter    127.0.0.1:1901    /jupyter    交互式笔记本
gpu-node   192.168.0.109:1901 /gpu-node  GPU 节点
```

---

## 核心特性

- 每个 Linux 用户自助配置，全程普通用户权限即可
- 每用户独立 MultiProx 密码（与系统登录密码无关）
- 一个共享 daemon 扫描所有用户配置并提供代理
- 网页仪表盘**只读**（登录、浏览、点击代理）；配置管理在 SSH 终端完成
- CLI：`add` / `remove` / `layout`（终端交互排序与分类）
- 用户配置为 **YAML**（`~/.config/multiprox/config.yaml`），非 INI
- 零重型框架，Node.js 原生 `http` + `js-yaml`

## 架构

```
                    multiprox daemon（共享网关，只需启动一次）
                    监听 0.0.0.0:1907
                    状态文件 ~/.local/state/multiprox/state.yaml
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   alice 自助配置         bob 自助配置         charlie ...
   ~/.config/multiprox/    同左
   config.yaml
```

| 角色 | 配置文件 | 说明 |
|------|----------|------|
| 运维/志愿者 | `~/.local/state/multiprox/state.yaml` | daemon 监听地址、session 密钥、用户扫描路径 |
| 普通用户 | `~/.config/multiprox/config.yaml` | 登录密码哈希、端口转发规则 |

代理 URL 格式：

```
http://<服务器>:1907/proxy/<用户名>/<服务名>/...
```

例如用户 `alice` 添加了名为 `jupyter` 的服务，访问路径为：

```
http://lab.example.com:1907/proxy/alice/jupyter/
```

---

## 安装

需要 Node.js >= 18。

```bash
npm install -g @seqyuan/multiprox
```

验证：

```bash
multiprox --help
```

---

## 快速开始

### 1. 运维：启动共享网关（一次）

在服务器上由一名用户（或专用账号）启动 daemon：

```bash
multiprox
```

默认监听 `0.0.0.0:1907`。首次运行会自动创建：

```
~/.local/state/multiprox/state.yaml
```

可用参数覆盖：

```bash
multiprox --host 0.0.0.0 --port 1907
```

建议用 `tmux` / `screen` / `nohup` 保持后台运行，或使用用户级 `systemd`（见文末示例）。

### 2. 普通用户：设置密码

每个需要使用代理的用户，在自己的账号下执行：

```bash
multiprox passwd
```

按提示设置 **MultiProx 登录密码**（无需原密码，首次可直接设置）。

会在当前用户 home 下创建：

```
~/.config/multiprox/config.yaml
```

### 3. 普通用户：添加端口转发

交互式（推荐，逐项填写，回车使用默认值）：

```bash
multiprox add
```

或非交互一行命令：

```bash
multiprox add --port 1901 --category 开发工具 jupyter 交互式笔记本
multiprox add --host 192.168.0.109 --port 1901 gpu-node GPU 节点
multiprox add --port 1901 --ws jupyter
```

默认值：`后端地址` = `127.0.0.1`，`WebSocket` = 否。

服务名 `jupyter` 会自动生成代理路径 `/jupyter`。

查看、删除与排序：

```bash
multiprox list
multiprox remove jupyter
multiprox layout    # 终端交互：上移/下移/改分类
```

### 4. 浏览器访问

1. 打开 `http://<服务器>:1907/`
2. 输入 **Linux 用户名** + **MultiProx 密码** 登录
3. 点击卡片进入服务，或访问 `/proxy/<用户名>/<服务名>/`

网页仅用于访问服务；添加/删除/排序请用上方 CLI。

---

## 命令参考

### 启动 daemon

```bash
multiprox [选项]

  -s, --state <path>   状态文件路径（默认 ~/.local/state/multiprox/state.yaml）
  --host <host>        监听地址（默认 0.0.0.0）
  --port <port>        监听端口（默认 1907）
  -h, --help           显示帮助
```

### 用户命令

```bash
multiprox passwd                              # 设置/重置当前用户密码
multiprox add [选项] [name] [description]   # 无 name/--port 时进入交互
multiprox list                                # 列出当前用户转发
multiprox remove <name>                       # 按名称删除
multiprox layout                              # 终端交互式排序与分类

  -c, --config <path>  指定用户配置文件（默认 ~/.config/multiprox/config.yaml）
```

---

## 配置文件说明

用户配置为 **YAML** 格式（非 INI），路径：

```
~/.config/multiprox/config.yaml
```

也支持使用 `.yml` 扩展名（若你自行创建符号链接或指定 `-c` 路径）。CLI 和网页保存时默认写入 `config.yaml`。

### 用户配置 `~/.config/multiprox/config.yaml`

```yaml
auth:
  password_hash: "<sha256-hex>"

services:
  - id: jupyter
    name: "jupyter"
    description: "交互式笔记本"
    host: "127.0.0.1"
    port: 1901
    path: "/jupyter"
    websocket: true
    category: "开发工具"
    order: 0
```

| 字段 | 说明 |
|------|------|
| `category` | 网页仪表盘分类（可选） |
| `order` | 排序权重，越小越靠前；网页拖拽会自动更新 |

通常无需手写，用 `multiprox passwd` / `multiprox add` 自动维护。

### Daemon 状态 `~/.local/state/multiprox/state.yaml`

```yaml
server:
  host: "0.0.0.0"
  port: 1907

auth:
  session_secret: ""      # 首次启动自动生成并写回
  session_ttl: 86400

users:
  home_prefix: "/home"    # macOS 上为 /Users
  scan_homes: true
```

daemon 会扫描 `{home_prefix}/*/.config/multiprox/config.yaml` 加载用户服务，每 10 秒自动刷新。

---

## 目录权限（重要）

共享网关模式下，**运行 daemon 的用户**必须能读取其他参与用户的配置文件。所有权限操作都在**各自账号下**完成，不需要管理员介入。

### daemon 需要读什么？

对每个参与用户 `alice`，daemon 至少要能读取：

```
/home/alice/.config/multiprox/config.yaml
```

路径上每一级目录都需要**进入（execute/search）权限**，配置文件需要**读权限**：

```
/home/alice/                        ← 需要 o+x
/home/alice/.config/                ← 需要 o+x
/home/alice/.config/multiprox/      ← 需要 o+x
/home/alice/.config/multiprox/config.yaml  ← 需要 o+r
```

### 每个参与用户自行执行

在**自己的账号下**运行（`multiprox passwd` / `multiprox add` 之后）：

```bash
# 若 home 为 700，daemon 无法进入，需开放「进入」权限（不能 ls，但能走到子路径）
chmod 711 ~

# 配置目录：允许他人进入
chmod 711 ~/.config
chmod 711 ~/.config/multiprox

# 配置文件：允许 daemon 运行者读取
chmod 644 ~/.config/multiprox/config.yaml
```

说明：

- `711` 目录：他人可以 `cd` 进入，一般不能 `ls` 列出内容（取决于上级目录权限）
- `644` 配置：本机其他用户可读。其中只有密码 **SHA-256 哈希**，不是明文；这是无管理员场景下最简单的共享方式
- 若你的 home 已是 `755`，通常只需处理 `.config` 和 `config.yaml`

### 权限自检

```bash
# 1. 查看路径各级权限
namei -l ~/.config/multiprox/config.yaml

# 2. 请 daemon 运行者在其终端验证能否读取（将 alice 换成你的用户名）
cat /home/alice/.config/multiprox/config.yaml
```

第二条能输出 YAML 内容，即表示 daemon 可以加载你的服务。

若不希望开放 home 进入权限，本工具的**共享网关模式**不适用，需改用其他部署方式（例如每人独立实例）。

### 网页与 CLI 分工

| 操作 | 方式 |
|------|------|
| 登录、浏览仪表盘、点击卡片代理 | 网页 |
| 添加 / 删除 / 排序分类 | SSH 终端：`multiprox add` / `remove` / `layout` |

共享网关下用户通常**没有**长期开放端口或常驻进程的条件，因此网页仪表盘设计为**只读**，避免 `multiprox agent` 一类需后台运行的方案。

### 用户 home 路径假设

daemon 扫描 `{home_prefix}/{linux用户名}/.config/multiprox/config.yaml`（默认 `/home/alice/...`）。若 home 不在该路径（如 `/data/alice`），当前版本**不会**自动发现，需自行保证路径符合约定。

### 常见问题

| 现象 | 可能原因 |
|------|----------|
| Web 登录失败 | 未执行 `multiprox passwd`，或密码错误 |
| 能 `add` 但不能 Web 登录 | 配置里仍是占位密码哈希，需先 `multiprox passwd` |
| 仪表盘无服务 | daemon 读不到你的 `config.yaml`，检查上方读权限 |
| 代理 404 | 服务名/路径不对，或配置尚未被 daemon 扫描（等待约 10 秒） |

---

## 安全说明

| 项目 | 说明 |
|------|------|
| 登录密码 | 每用户独立，存 SHA-256 哈希；与 Linux 系统密码无关 |
| Session | HMAC 签名 Cookie；HTTPS 或 `X-Forwarded-Proto: https` 时自动加 `Secure` |
| 代理隔离 | 只能访问 `/proxy/<自己的用户名>/...`，不能越权访问他人路径 |
| 子路径转发头 | 向后端附加 `X-Forwarded-Host` / `Proto` / `Prefix` / `For`，便于 annovibe 等识别外部 URL |
| 后端地址 | 仅允许本机（`127.0.0.1`）和私网（`10.x` / `172.16-31.x` / `192.168.x`），禁止转发到公网 |
| 配置文件 | 默认 `chmod 644` 时本机用户可读哈希；请设置足够强的 MultiProx 密码 |

---

## 注意事项

1. **先 `passwd` 再登录**：新建配置时密码哈希为占位值，必须 `multiprox passwd` 后才能 Web 登录。
2. **网页只读**：添加/删除/排序用 `multiprox add` / `remove` / `layout`。
3. **变更自动生效**：CLI 修改后无需重启 daemon（约 10 秒内刷新）。
4. **WebSocket 服务**：Jupyter、VS Code Server 等需加 `--ws`。
5. **服务名与路径**：`name` 会 slug 化后作为路径，如 `GPU Node` → `/gpu-node`。
6. **对外访问**：默认监听 `0.0.0.0:1907`；若从其他机器访问不到，检查机器网络策略或端口是否可达。
7. **后端服务绑定**：本机服务应监听 `127.0.0.1` 或 `0.0.0.0`；若只监听 `127.0.0.1`，转发目标用默认 `--host` 即可。
8. **开放权限**：参与共享网关的用户需按上文设置 home / 配置目录权限，否则 daemon 无法发现你的服务。
9. **子路径应用**：转发时附带 `X-Forwarded-Prefix`（如 `/proxy/alice/annovibe`）；若应用仍生成错误链接，在其配置里设置 `base_url` / `root_path` 为此外部前缀，并视情况加 `--ws`。

### 子路径与子代理（如 annovibe 图片预览）

MultiProx 只做透明路径转发，应用内部的子 API、图片预览、嵌套 proxy **通常不受影响**。

访问 `http://lab:1907/proxy/alice/annovibe/...` 时，MultiProx 会向后端附加：

| 请求头 | 示例 |
|--------|------|
| `X-Forwarded-Prefix` | `/proxy/alice/annovibe` |
| `X-Forwarded-Host` | `lab:1907` |
| `X-Forwarded-Proto` | `http` 或 `https` |
| `X-Forwarded-For` | 客户端 IP |

若应用支持读取这些头或配置公共 URL，子功能（预览图等）即可拼出正确外链。若页面仍写死 `127.0.0.1` 或根路径 `/api/...`，需在应用侧配置 base URL，并对 WebSocket 服务使用 `multiprox add --ws`。

---

## 后台运行示例（普通用户）

### tmux / screen

```bash
tmux new -s multiprox
multiprox --host 0.0.0.0 --port 1907
# 按 Ctrl+B 然后 D 脱离会话
```

### nohup

```bash
nohup multiprox --host 0.0.0.0 --port 1907 > ~/.local/state/multiprox/daemon.log 2>&1 &
```

### 用户级 systemd（无需管理员）

```ini
# ~/.config/systemd/user/multiprox.service
[Unit]
Description=MultiProx shared gateway

[Service]
ExecStart=%h/.npm-global/bin/multiprox --host 0.0.0.0 --port 1907
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
# 将 ExecStart 中的路径换成 which multiprox 的实际输出
systemctl --user daemon-reload
systemctl --user enable --now multiprox
systemctl --user status multiprox
```

若希望**退出 SSH 后仍保持运行**，在当前用户下执行：

```bash
loginctl enable-linger "$USER"
```

（多数系统允许用户自行开启 linger；若被拒绝，改用 `tmux` / `nohup`。）

## 开发与发布

```bash
git clone https://github.com/seqyuan/multiprox.git
cd multiprox
npm install
npm run build
npm test
npm start
```

发布到 npm（维护者）：

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions 会在 tag 推送后自动发布 `@seqyuan/multiprox`。

---

## License

MIT
