# dsh-session-delete

> DSH（DeepSeek Harness）profile 插件：给会话列表加一个真正删除会话的动作，附批量勾选删除。
> 仓库：https://github.com/ChenJun25/dsh-session-delete · 许可证：MIT

给 DSH 的会话列表加一个**真正删除会话**的动作（原来只有"归档"）。
产品本身把"没有 Session 删除"写成了设计约束（见
`@deepseek-ai/dsh-client-ui-workspace` 的 Known Limitations），所以这里用
**profile 本地插件**实现，不改动随发行版交付的代码。

## 界面行为

会话行右侧 `…` 菜单里，在"归档会话"下面多一项 **删除会话**：

1. 点击后弹出确认框，写明"…及其子会话在本机的全部记录会被永久删除，无法撤销"。
2. 确认后调用宿主 `POST /api/session.delete`。
3. 成功后自动刷新会话列表，并把该会话从工作区成员名单里摘掉（宿主半边 `detachSession`），
   被删的行从侧栏消失；失败时在框内显示原因。

删除是**不可撤销**的（不同于归档）。

### 批量删除（v1.1.0）

工作区名右侧的 `…` 菜单里多一项 **批量删除会话…**，进去以后：

1. 每条会话行首出现勾选圈，点一下选中（实心圆 + 白勾）；
2. 侧栏右侧竖排一条工具条：`已选 N 个会话` / 全选 / 清除 / 删除所选 / 取消；
3. 点「删除所选」弹确认框，写明所选会话（含各自子会话）在本机的全部记录会被永久删除；
4. 确认后逐条走同一个 `POST /api/session.delete`，结束时给出汇总：全成功、或「已删 N 个；M 个未能删除（会话仍有工作在跑或已不存在）」；
5. 删完自动退出批量态并刷新列表。

勾选态、工具条计数、全选与清除共用一份本地 store，所以三个 slot（菜单入口、行首勾选圈、工具条）看到的是同一个状态。

## 宿主如何判断"能不能删"

| 情况 | 行为 |
| --- | --- |
| 会话仍有**正在运行的工作**（回合 / 子代理 / 后台任务 / 定时提醒，由 `workspace/session-activity` waterfall 报告） | `409 session-delete/session-active`，不做任何改动，界面列出工作类型 |
| 会话**活着且被 Agent 持有** | 先 `AgentRegistry.get(id).dispose()`（停 loop、注销、从 live store 移除），响应里回 `closedAgent` |
| 会话**活着但没有 Agent**（进程打开过、内存里挂着，典型是没说过话的空会话） | 从 live store 里 `detach()` 掉，响应里回 `evictedLive`；拿不到 detach 句柄时回 `stillLive` |
| 磁盘上没有、内存里也没有 | `404 session-delete/not-found`（界面顺带刷新一次列表，把残留的行清掉） |

为什么"活着但没有 Agent"也必须摘掉：**宿主的会话列表 = 磁盘扫描 + 内存 live store**
（`session-query.listSessions`），所以只要它还活在内存里，删掉文件后列表照样返回它，
侧栏那行就永远不消失——这正是"删除不好使"的原因。摘除时会发出 `session/disposed`，
日志写入方据此关闭句柄。

### 侧栏那一行的两个来源（2026-10-06 补）

宿主 `listSessions()` 只是其中一个来源。前端侧栏渲染一条会话行要**同时**满足：

1. 该 id 在工作区注册表的成员名单里 —— `workspace.json` 各工作区的 `sessionIds` 数组；
2. 该 id 在会话列表里 —— `sessions.list()`（磁盘 + 内存 live store）。

名单侧由 `WorkspaceEntity.get sessionIds()` 提供：它拿持久化的 `sessionIds` 当候选，
再用宿主内存索引 `sessionPaths` 逐条过滤
（`return this.record.sessionIds.filter(id => this.host.sessionPath(id) === this.record.path)`）。
`sessionPaths` **只在 DSH 启动那一刻**从持久化快照灌入（`replaceHeaderIndex()`），
之后只会新增，从不按「会话日志还在不在」清理。

后果：v5 及更早只删磁盘文件、不摘名单，于是**被删的会话在宿主重启前会一直挂在侧栏**
（行还在，点开是空的）。v6 修的就是这一半。

### v6：删除时真正摘掉成员名单

`forgetInRegistry()` 除了原有的 `unpinSession` / `unarchiveSession`，现在会调用
`detachFromWorkspaces()`：遍历 `workspaceRegistry.list()`，对每个仍记账该 id 的
`WorkspaceEntity` 调 `detachSession(id)`（注册表原型上没有这个方法，但 `list()` 交出来的
实体有；它是宿主里唯一的成员摘除写入）。

为什么这样就不必重启：`detachSession` → 实体 `mutate()` → 工作区表 `update()` 会发出
`domain/changed`（`domain:'workspace'`、`table:'workspaces'`），宿主 `WorkspaceFeed` 据此
推送一条 `upsert` 增量给浏览器，`workspaces.list` 随即更新，名单里没了这个 id，
那行当场消失。副产物：`mutate()` 每次写入都会按 `sessionPath` 重新过滤一遍 `sessionIds`，
所以**任何一次工作区写入都会顺手剪掉所有已失效的 id**（惰性剪枝）。

> 更早的版本是"活着就拒绝"，结果用户没在用、只是被进程挂着的空会话永远删不掉
> （审计日志里 `refused live session=...` 那几行）。删除当前**正在跑**的会话仍会被
> 拒绝，这是故意的：正在跑的回合还在往日志里写。

## 实际删除的内容

- `$DSH_HOME/sessions/<工作目录作用域>/<会话 id>/` —— 全部作用域目录下的会话日志目录
  （会话日志本身、检查点等都在这个目录里）。
- 子会话（子代理）默认一并删除：血缘通过 `sessionQuery.traceSession()` 取，取不到时
  只删请求的那一个。
- `$DSH_HOME/storages/session_projcache/**/<会话 id>.json` —— 投影缓存记录（派生数据）。
- 工作区注册表里的**成员名单**：每个仍记账它的工作区（`workspace.json` 的
  `sessionIds`）都会 `detachSession()` 把它摘掉，浏览器随即收到一条工作区 `upsert` ——
  **这是「点删除后那行立刻消失、不用重启」的关键**。
- 工作区注册表里的**置顶/归档**记账（`unpinSession` / `unarchiveSession`，两者对不存在的 id
  都是无操作）。

不会删除：`$DSH_HOME/attachments`（内容寻址、可能被别的会话共用）、对话里引用过的
外部文件。

## 配置

在 profile 的 `cordis.patch.yml` 里给这一行加 `config`（不写就是默认值）：

```yaml
- insert:
    - id: session-delete
      name: dsh-session-delete
      config:
        deleteDescendants: false  # false = 只删这一个会话，保留子会话
        # logFile: false          # 关闭审计日志
        # logFile: "D:/tmp/session-delete.log"
        # sessionsRoot: "..."     # 覆盖默认的 $DSH_HOME/sessions
        # storagesRoot: "..."     # 覆盖默认的 $DSH_HOME/storages
```

## 审计日志

每一次删除尝试（成功或拒绝）都会往 `$DSH_HOME/session-delete.log` 追一行：

```
2026-09-29T00:21:40.986Z plugin activated v5 routes=/api/session.delete,/api/session.delete/ready
2026-09-29T00:23:31.275Z deleted session=86c8d3dd-... sessions=1 directories=1 cache=1 closedAgent=- evictedLive=86c8d3dd-... liveAfter=-
2026-09-29T00:24:40.512Z refused active session=session-3ccc... families=turn
```

`liveAfter=-` 表示删完之后这个会话在内存里也不留痕了（列表不会再返回它）。
`browser plugin applied` 这一行由浏览器半边在 `apply()` 时打点，用来确认页面里的插件真的
装上了（页面上没看到"删除会话"时先看这一行）。

## 打包 / 安装 / 升级

这是一个标准的 DSH **bundle** 包：`package.json` 里 `dsh.bundle.patch` 指向包内的
`cordis.patch.yml`，那一行 `insert` 才是插件的 Loader 行。所以**安装/重装不需要改任何
配置文件**，也不需要手写 `insert`。

## 安装

这是一个标准的 DSH **bundle** 包：`package.json` 里 `dsh.bundle.patch` 指向包内的
`cordis.patch.yml`，那一行 `insert` 才是插件的 Loader 行。所以**安装/重装不需要改任何
配置文件**，也不需要手写 `insert`。

| 项 | 值 |
| --- | --- |
| 包名 | `dsh-session-delete` |
| Loader 行 | 包内 `cordis.patch.yml`（不要再在 profile 的 `cordis.patch.yml` 里写第二遍，id 会冲突） |
| 宿主半边 | `lib/host.js`（`main` / `exports["."]`） |
| 浏览器半边 | `lib/client.js`（`exports["./client"]`，配 `dsh.client`） |
| 运行依赖 | 无。宿主半边只用 Node 内置模块，浏览器半边只引静态种子模块（react / react/jsx-runtime / ui-primitives / client-store） |

**装法**

```powershell
# 方式一：插件页 → 安装 → 填本地目录或 tarball 的绝对路径（会自动加进 bundles）
# 方式二：手动 link 本地源码
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add "link:<源码目录绝对路径>"
# 然后确认 profile 的 package.json 里 dsh.profile.bundles 有 "dsh-session-delete"
```

**为什么不会再"重装就没了"**

- 它是 profile 的**声明依赖**，pnpm 操作不会把它当多余包装清掉。
- 它在 `dsh.profile.bundles` 里，插件页能看到、能停用/启用/卸载。
- Loader 行在包内部，重装只要装包，不用碰 profile 配置。
- 数据（会话、审计日志）都在 `~/.dsh` 下，重装应用不影响。

**升级**：替换源码目录（或重装新 tarball）后刷新页面；宿主半边需要重启 DSH 或插件页重载。

**卸载**：插件页卸载，或从 `dsh.profile.bundles` 去掉 + `pnpm remove dsh-session-delete`。

**改动什么时候生效**

- 浏览器半边：`dsh-client-hmr` 每 500ms 轮询产物文件，改完 `lib/client.js` 后刷新页面即可
  （不刷新也行，页面会通过 SSE 收到新 rev 并重新加载）。
- 宿主半边：默认**不会**自动热重载（要 profile 的 `cordis.patch.yml` 里配了 `hmr` 且
  `config.root` 覆盖到本包才行），所以改完 `lib/host.js` 一般要重启 DSH 或插件页重载才会
  生效；生效后审计日志会多一行 `plugin activated vN ...`。
  - 打开热重载时注意 `hmr.base` 不要写成 Windows 绝对路径：它要过 `new URL()`，
    `C:/...` 会被当成 `c:` 协议，整个配置热重载都会挂掉。

## 回滚

1. 插件页卸载，或删掉 profile 的 `package.json` 里 `dependencies` 与
   `dsh.profile.bundles` 的 `dsh-session-delete` 两项，配置热重载后菜单项立即消失；
   重载不灵就重启应用。
2. 删掉 `node_modules\dsh-session-delete`（link/Junction）即可；真实源码目录可以留着。
3. 已删除的会话**无法恢复**，这与插件是否卸载无关。

## 测试

```powershell
node test/delete-core.test.mjs      # 删除/关闭活会话/拒绝运行中/路径遍历防护/路由注册/摘名单
node test/client-bundle.test.mjs    # 浏览器 bundle 的注册形状与两条 slot
node test/real-layout.test.mjs      # 对真实 $DSH_HOME 布局的集成检查（自带一次性作用域，跑完全部清理）
```

`real-layout.test.mjs` 会在真实 `$DSH_HOME/sessions` 下建一个**合成**作用域目录并删除它，
跑完断言其余会话目录一个都没变，最后在 `finally` 里清理。
