# MultiProx

**一台 Linux 服务器，一个 Web 入口，每人管理自己的 Jupyter / RStudio / 内网服务。**

MultiProx 是面向实验室、登录节点的**多用户认证反向代理**：运维志愿者启动一个共享网关，普通用户登录网页管理转发（添加卡片、拖动排序），也可选用 CLI，无需每人记不同端口。

登录页 + 仪表盘：点击卡片访问；支持网页添加、拖动排序与分类

---

## 这是什么？

假设服务器 `lab.example.com` 上有三个用户，各自跑着不同服务：


| 用户    | 本机服务           | 原始地址（仅本机可访问）         |
| ----- | -------------- | -------------------- |
| alice | Jupyter Lab    | `127.0.0.1:1901`     |
| alice | RStudio        | `127.0.0.1:8787`     |
| bob   | VS Code Server | `127.0.0.1:8080`     |
| bob   | 内网 GPU 节点      | `192.168.0.109:1901` |


**没有 MultiProx：每人要记住端口，或找管理员改 nginx。**

**有了 MultiProx：统一从** `http://lab.example.com:1907` **登录，点击卡片即可访问**：

```text
http://lab.example.com:1907/proxy/alice/jupyter/
http://lab.example.com:1907/proxy/alice/rstudio/
http://lab.example.com:1907/proxy/bob/vscode/
http://lab.example.com:1907/proxy/bob/gpu-node/
```

---

## 一分钟上手

```bash
# ① 运维：启动网关（一次）
multiprox
# 或指定端口：multiprox --port 1908

# ② 用户 alice：设密码（共享网关下会自动修复目录权限）
# linux用户账号即为登陆账号
multiprox passwd

# ③ 浏览器管理（推荐）
http://lab.example.com:1907/  →  登录  →  点 + 添加、拖动排序、点击卡片访问

# ③ 备选：终端 CLI
# multiprox add          # 交互式添加服务端口
# multiprox layout       # 交互式排序与分类
```

## 工作流程

```text
运维启动 multiprox（共享网关）
        │
        ▼
用户 multiprox passwd（设密码；共享网关下修复目录权限）
        │
        ├──────────────────────┐
        ▼                      ▼
网页：+ 添加 / 拖动 / 删除     CLI：add / remove / layout
        │                      │
        └──────────┬───────────┘
                   ▼
        写入 ~/.config/multiprox/config.yaml
                   ▼
        daemon 扫描加载（约 10 秒刷新）
                   ▼
        浏览器登录，访问 /proxy/<用户>/<服务>/
```

---

## 安装

需要 Node.js >= 18。

```bash
npm install -g @seqyuan/multiprox
multiprox --help
```

---

## 快速开始

### 1. 运维：启动共享网关（一次）

```bash
multiprox
```

默认监听 `0.0.0.0:1907`，首次运行创建 `~/.local/state/multiprox/state.yaml`。

```bash
multiprox --host 0.0.0.0 --port 1908   # 自定义端口，写入 state.yaml
multiprox stop                          # 停止后台实例
```

### 2. 普通用户：设置密码

```bash
multiprox passwd
```

设置 **MultiProx 登录密码**（与 Linux 系统密码无关），并创建 `~/.config/multiprox/config.yaml`。

共享网关下，`passwd` 还会在设密后自动修复目录权限，使网关进程能读写你的配置（网页添加/拖动需要写权限）。详见下文「passwd 与目录权限」。

### 3. 添加与管理转发

**网页（推荐）**：登录后点击 **+** 添加，拖动 `⋮⋮` 排序与归类，点击 `×` 删除。

**CLI（备选）**：

```bash
multiprox add       # 纯交互式，逐项填写
multiprox list
multiprox remove jupyter
multiprox layout    # 终端交互：上移/下移/改分类
```

服务名 `jupyter` 自动生成代理路径 `/jupyter`。默认后端地址 `127.0.0.1`。

登录后除 `/proxy/<用户>/jupyter/` 外，也兼容旧版单用户路径 `/proxy/jupyter/`（Jupyter `base_url` 可保持不变）。

### 4. 浏览器访问

1. 打开 `http://<服务器>:1907/`
2. 用 **Linux 用户名** + **MultiProx 密码** 登录
3. 点击卡片进入服务

---

## 命令参考

### 启动 / 停止 daemon

```bash
multiprox [选项]
multiprox stop [选项]

  -s, --state <path>   状态文件（默认 ~/.local/state/multiprox/state.yaml）
  --host <host>        监听地址（默认 0.0.0.0）
  --port <port>        网关监听端口（默认 1907；写入 state.yaml）
  -h, --help
```

### 用户命令

```bash
multiprox passwd              # 设密码；共享网关下修复目录权限
multiprox add                 # 交互式添加后端转发
multiprox list
multiprox remove <name>
multiprox layout

  -c, --config <path>         # 用户配置（默认 ~/.config/multiprox/config.yaml）
```

> `multiprox --port` 是**网关监听端口**；`multiprox add` 交互填写的端口是**后端服务端口**，两者不同。

---

## passwd 与目录权限

共享网关模式下，daemon 以**运维账号**运行，却要读/写各用户 home 下的 `~/.config/multiprox/config.yaml`（网页保存配置需要写权限）。普通用户在自己账号下执行 `multiprox passwd` 即可完成，无需 root。

### 何时会改权限？

`multiprox passwd` 根据网关运行者判断：


| 情况                       | `passwd` 是否修改权限 |
| ------------------------ | --------------- |
| 网关由**他人**启动（常见共享场景）      | **会**自动修复       |
| **你自己**启动并运行 `multiprox` | **不会**，保持原有私有权限 |
| 配置文件不在当前用户 home 内        | 跳过，并提示          |


判断依据：正在运行的 daemon 进程属主，或 `~/.local/state/multiprox/state.yaml` 的属主（daemon 未运行时）。

### 会自动修改哪些路径？

仅处理当前用户 home 内的路径：

```
~                                    ← 若他人无进入权限，设为 711；已是 755 等可遍历则不动
~/.config                            ← 同上
~/.config/multiprox                  ← 同上
~/.config/multiprox/config.yaml      ← 666（所有人可读写，供网关进程写入）
```

说明：

- **711 目录**：他人可 `cd` 进入路径，一般不能 `ls` 列出 home 内容（目录不需要 777）
- **666 配置**：所有人可读写；网关以他人身份运行时可直接更新配置（比 644/664 更直接）
- 密码仅存 **SHA-256 哈希**，但配置对本机所有用户可写，请使用足够强的 MultiProx 密码

### 终端输出示例

共享网关（权限有变更）：

```text
[multiprox] password updated in /home/alice/.config/multiprox/config.yaml
[multiprox] updated shared-gateway permissions:
  /home/alice -> 0711
  /home/alice/.config -> 0711
  /home/alice/.config/multiprox -> 0711
  /home/alice/.config/multiprox/config.yaml -> 0666
```

（`config.yaml` 为 **0666**，与上文 **666** 一致。）

自启网关（跳过权限修改）：

```text
[multiprox] password updated in /home/alice/.config/multiprox/config.yaml
[multiprox] gateway operator is current user; home/config permissions unchanged
```

- 仪表盘无服务或网页无法保存 → 重新执行 `multiprox passwd`
- 若 home 为 `700` 且不愿开放进入权限 → 不适用共享网关模式

---

## License

MIT