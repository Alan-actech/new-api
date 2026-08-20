# SPEC — 每用户并发限制（per-user concurrency limit）

## 目标
在 new-api（`new-api:custom` 本地构建）relay 层增加**每用户「同时在跑请求数」**上限：
- 每个用户独立计数（不是全组共享）。
- **两档限流,行为不同**（2026-08-13 确认）：
  1. **硬顶三个账号**：Barry Wang（vip, id=8）、image-service（internal functional, id=18）、zhengwu.liu(ai-game-service, id=6）—— 各自 10 并发,**超限直接 429**,不排队。这三个都是持续跑批量任务的账号（Barry 出图 prod、其余两个疑似游戏内容生成流水线),用意是设一道硬上限防止把共享池占满,不是限制他们的正常吞吐,所以给到比普通人类账号更高的 10。
  2. **default 组的普通 OIDC 人类账号**：**5 并发,超限排队等待(最长 300 秒)**,300 秒内等到空位就放行,等不到才 429。行为上是"排队",不是"秒拒",体验上更像限速而不是硬拦截。
- **alan（user_id=2, Root User）豁免**，不限并发。
- **admin / alan2 / 1111 / 222 / jack / ctfwulala**（`default` 组里非 `oidc_` 前缀的账号,身份不明或是测试账号）**豁免**，不纳入 5 并发限制——只限 `oidc_` 前缀的真人账号。
- 运行时可开关，无需重部署即可关闭（回滚安全）。

## 最终决策（用户已确认，2026-08-13）

### 用户分档
| 档位 | 账号 | 上限 | 触发行为 |
|---|---|---|---|
| 豁免 | alan(2)、admin(1)、alan2(3)、1111(4)、222(5)、jack(22)、ctfwulala(24) | 不限 | — |
| 硬顶 10 | Barry Wang(8)、image-service(18)、zhengwu.liu/ai-game-service(6) | 10 | **直接 429**,不排队 |
| 硬顶 5(含图片子限额) | rextrix-ai-gen(25) | 5 通用 + 5 图片 | **直接 429**,不排队。图片限额与通用限额相同值,故图片请求本身已被通用上限约束,不需要单独的图片子限额字段 |
| 硬顶 10(含图片子限额) | rextrix-aiplay-gen(26) | 10 通用 + 10 图片 | 同上,直接 429,通用上限已覆盖图片场景 |
| 排队 6(个人覆盖) | Jonathon He(9) | 6 | **排队等待,最长 300s**,行为与排队档相同,只是阈值单独调高（2026-08-18 确认：实测他一人峰值打到过16并发，是把 cfoster/jdubfrank 主力池顶满、拖累 Barry 出图的主因；给6是折中——比default 5 略宽松，但远低于他实测峰值） |
| 排队 5 | 其余所有 `oidc_` 前缀账号（7,10,11,12,13,14,15,16,17,19,20,21,23 等,含 Feifei/Fred=21、Angelus=12 等,不含 Jonathon=9,他单独覆盖为6） | 5 | **排队等待,最长 300s**,300s 内轮到就放行,超时才 429 |

- **覆盖范围：文本 + 出图所有模型请求都计数**（不是只算 gpt-image-2）。
- `ModelConcurrencyLimitExemptModels`（按模型前缀排除,如 `claude`）本次**不使用**——按用户分档已经覆盖了所有场景,不需要再按模型排除。
- 新增用户的默认行为：以后新建的 `oidc_*` 账号如果落在 `default` 组、且没有显式加入豁免/硬顶名单，自动吃排队 5 档（因为是按 group 兜底，不需要每次新增用户都改配置）。非 `oidc_` 前缀的新账号需要手动决定加不加入豁免名单。

### 生效优先级（每用户实际上限）
1. `ExemptUserIds` 命中 → 不限。
2. `UserOverride[userId]` 命中 → 用该值,**触发行为=直接拒绝（reject）**（Barry/image-service/zhengwu.liu=10，rextrix-ai-gen(25)=5，rextrix-aiplay-gen(26)=10）。rextrix 两个账号的"图片并发"要求与各自通用上限数值相同，因此只用通用 UserOverride 即可满足，不需要为 reject 档单独实现图片子限额字段（该字段目前只在 queue 档为 default 组设计）。
3. `UserQueueOverride[userId]` 命中 → 用该值,**触发行为=排队等待**（Jonathon(9)=6）。优先于组级排队上限，但仍是排队行为，不是拒绝。
4. 否则用 `Group[group]`（`default` = 5），**触发行为=排队等待（queue, maxWaitSeconds=300）**。
5. 组不在 map（如 `vip` 且未被单独 override）→ 不限。

## 背景 / 为什么不能用现有限流
- new-api 现有 `middleware/model-rate-limit.go` 是**每用户「每 N 分钟请求次数」限速**（令牌桶 + Redis LIST 计数），**不是并发数**。
- gpt-5.6-sol 单请求常跑 30–60s，甚至到 60min；40 个并发一分钟才 40 次，任何 req/min 限速都拦不住并发。
- 真并发瓶颈在上游共享 sub2api 账号池（出图账号 cfoster/jdubfrank 各 concurrency=12，全局出图闸 10）。目标是在 new-api 入口按用户切分，防止单用户挤垮共享道、把别人一起 429 掉。

## 设计

### 计数原语：Redis ZSET + Lua（自愈式并发闸，两档共用同一套原语）
> 生产 `RedisEnabled=true`（ai-redis 容器）。用 ZSET 每 slot 独立过期，避免 INCR/DECR 卡死泄漏。

- key：`concurrency:{userId}`
- **acquire（reject 档，Barry/image-service/zhengwu.liu 用）**——单次原子 Lua：
  1. `ZREMRANGEBYSCORE key 0 (now - maxAgeSeconds)` —— 清理卡死/泄漏的旧 slot
  2. `cur = ZCARD key`
  3. `if cur >= limit: return DENY(cur)`
  4. `ZADD key now {requestId}` → `return ALLOW(cur+1)`
  5. `DENY` → 立即 `abortWithOpenAiMessage(c, 429, ...)`，不重试。
- **acquire（queue 档，default 组 5 并发用）**——同一个 Lua 脚本轮询：
  1. 首次调用同上；`DENY` 时不立即报错，改为**轮询重试**：每 `pollIntervalMs`（建议 300–500ms，加小幅随机抖动防惊群）重新执行同一 Lua 脚本一次。
  2. 轮询期间用 `context.WithTimeout(c.Request.Context(), maxWaitSeconds)`（300s）控制总等待时长；ctx 到期仍未 `ALLOW` → `abortWithOpenAiMessage(c, 429, "排队超时，请稍后重试")`。
  3. 轮询期间需要监听 `c.Request.Context().Done()`（客户端提前断开）及时退出，避免 goroutine 泄漏。
  4. 拿到 `ALLOW` 后走正常流程；退出时同样 `ZREM`。
- 退出时（`defer`，`c.Next()` 之后，流式/非流式都在流结束后返回）：`ZREM key {requestId}`。
- `requestId`：复用 new-api context 里的 request id（无则生成 uuid）。
- `maxAgeSeconds = 7200`（2h，覆盖实测最长 ~64min 任务；卡死 slot 2h 后自愈）。
- Lua 脚本放 `common/limiter/lua/concurrency.lua` 或中间件内 `redis.NewScript` 内联，reject/queue 两档复用同一个脚本，只是调用方式不同（单次 vs 轮询）。

### 内存兜底（`RedisEnabled=false`）
- `map[int]int` + `sync.Mutex`，进入 `++`（超限按对应档位 reject 或 sleep-poll）、`defer --`。best-effort、无自愈。生产走 Redis，此路仅本地兜底，注释标明。

### 豁免逻辑
- `ModelConcurrencyLimitExemptUserIds`（`[]int`）里的 user_id **直接放行**，不计数不拦截。`[2, 1, 3, 4, 5, 22, 24]`（alan、admin、alan2、1111、222、jack、ctfwulala）。
- 按 user_id 豁免（不动豁免账号的 group / 计费 group_ratio）。

### 模型识别（本次不需要，仅保留 helper 供未来复用）
- 中间件与 `Distribute` 同属 `package middleware`，如未来需要按模型排除，可复用 `getModelFromRequest(c)`（`distributor.go:175`）body 安全 peek。本次所有模型都计数，不调用这一步。

### 判定顺序（中间件）
1. `if !ModelConcurrencyLimitEnabled → c.Next()`
2. `userId := c.GetInt("id")`；`if userId ∈ ExemptUserIds → c.Next()`
3. `limit, mode, ok := ResolveUserLimit(userId, group)`：
   - `UserOverride[userId]` 命中 → `(limit, reject, true)`
   - 否则 `Group[group]` 命中 → `(limit, queue, true)`
   - 都不命中 → `(_, _, false)`
4. `if !ok → c.Next()`（未配置=不限，如 vip 且未单独 override）
5. `mode == reject` → 单次 acquire，失败即 429。
   `mode == queue` → 轮询 acquire，最长等待 `maxWaitSeconds`（300），超时才 429。
6. 通过 → `defer release()`；`c.Next()`。

## 改动文件
1. `setting/concurrency_limit.go`（新）—— 仿 `rate_limit.go`：
   - `var ModelConcurrencyLimitEnabled = false`
   - `var ModelConcurrencyLimitGroup = map[string]int{}`  // {"default": 5}，触发行为固定为 queue
   - `var ModelConcurrencyLimitUserOverride = map[int]int{}`  // {8:10, 18:10, 6:10}，触发行为固定为 reject
   - `var ModelConcurrencyLimitExemptUserIds = []int{}`  // [2,1,3,4,5,22,24]
   - `var ModelConcurrencyLimitQueueMaxWaitSeconds = 300`
   - `ResolveUserLimit(userId, group) (limit int, mode string, ok bool)`（优先级：exempt→override(reject)→group(queue)→不限）
   - 各 map 的 `...2JSONString()` / `Update...ByJSONString()` / `Check...()` / `IsUserExempt(id)`
   - 用 `common.Marshal/Unmarshal`（Rule 1），mutex 保护 map（仿现有）
2. `middleware/model-concurrency-limit.go`（新）—— `ModelConcurrencyLimit() gin.HandlerFunc`：
   - reject 档：单次 Lua acquire，DENY 直接 429。
   - queue 档：轮询 Lua acquire + `context.WithTimeout` 300s + 监听客户端断开，超时 429。
   - Redis/内存两路，release 用 `defer`。
3. `common/limiter/lua/concurrency.lua`（新，或内联 `redis.NewScript`）。
4. `model/option.go` —— OptionMap 注册 6 个 key（仿 136/167 行）+ 加载分支解析（仿 347/507-514 行）：`ModelConcurrencyLimitEnabled` / `ModelConcurrencyLimitGroup` / `ModelConcurrencyLimitUserOverride` / `ModelConcurrencyLimitUserQueueOverride` / `ModelConcurrencyLimitExemptUserIds` / `ModelConcurrencyLimitQueueMaxWaitSeconds`。
5. `controller/option.go` —— 更新校验（仿 271 行）：group/override JSON 合法性 + exempt userId 为整数数组。
6. `router/relay-router.go` —— 在 `relayV1Router`(第 73 行后) 与 `relayGeminiRouter`(第 193 行后) 各加 `.Use(middleware.ModelConcurrencyLimit())`（必须在 `TokenAuth()` 之后，紧挨 `ModelRequestRateLimit()`）。`/v1` 已含 `/v1/messages`（Claude），故 gpt 与 claude 全覆盖（虽然本次两档都不按模型排除，全量覆盖即可）。
7. （可选，可后补）前端 `web/default/src/features/system-settings/request-limits/` 增设 UI。**先不做**，配置用 option API / DB `options` 表直接写。

> Rule 2 跨库：不涉及 schema/迁移（配置存 `options` 表既有 JSON 文本列）。Rule 5：不动 new-api/QuantumNous 标识。

## 部署后配置值（option API 或 DB options 表）
- `ModelConcurrencyLimitEnabled = true`
- `ModelConcurrencyLimitGroup = {"default": 5}`（触发=排队,maxWait=300s）
- `ModelConcurrencyLimitUserOverride = {"8": 10, "18": 10, "6": 10, "25": 5, "26": 10}`（Barry / image-service / zhengwu.liu / rextrix-ai-gen / rextrix-aiplay-gen，触发=直接429）
- `ModelConcurrencyLimitUserQueueOverride = {"9": 6}`（Jonathon He，触发=排队，阈值高于default组的5）
- `ModelConcurrencyLimitExemptUserIds = [2, 1, 3, 4, 5, 22, 24]`（alan / admin / alan2 / 1111 / 222 / jack / ctfwulala）
- `ModelConcurrencyLimitQueueMaxWaitSeconds = 300`

## 验证计划（先验证后宣称）
1. 用一个 default 组人类 OIDC 测试 token（非上表任何特殊账号）并发打 **20 路** gpt 请求 → 前 5 路立即通过，其余排队；总耗时内**排队的请求最终应逐个通过**（不是全部 429），只有真正等满 300s 还没轮到的才 429。
2. 用 Barry / image-service / zhengwu.liu 的 token 并发打 **20 路** → 恰好 **10 通过，其余立即 429**（不排队，响应要快，验证是 reject 不是 queue）。
3. 用 alan（id=2）和 admin/alan2/1111/222/jack/ctfwulala 的 token 各并发打 20 路 → **全通过**（豁免生效）。
4. 突发结束后单发 1 路 → 成功（slot 已释放，ZREM 生效，不管哪一档）。
5. 关开关 `ModelConcurrencyLimitEnabled=false` → 立即恢复不限（无需重部署，验证回滚）。
6. 流式验证：`stream=true` 测试排队档和 reject 档，确认 slot 在流结束后释放（非提前/泄漏）。
7. 排队档验证客户端提前断开连接的场景：排队中途 client 断开 → goroutine 应能及时退出，不留下悬挂的等待协程。
- 测试脚本：scratchpad，走 `https://ai-demo.bio-matrix.io`，PYTHONUTF8=1。

## 未决 / 需确认
- **构建管线**：Dockerfile 已确认（标准三段：bun 前端×2 + `go build`，golang:1.26.1-alpine → debian-slim）。待定：`new-api:custom` 在**服务器上 `docker compose build`** 还是本地 build 再传镜像。实现 session 首步确认（注意 t3.large 2vCPU/8GB 跑 bun 前端构建可能慢/吃内存，必要时本地构建 `docker save`/`load`）。
- **回滚**：保留旧 `new-api:custom` 镜像 tag；运行时开关 `ModelConcurrencyLimitEnabled=false` 为主回滚手段（即时，无需重部署）。
- **image-service(18) / zhengwu.liu(6) 的真实身份未逐一核实**——用户按账号命名判断这是自动化/服务账号，给了和 Barry 同档（10并发+429）的处理。实现前建议快速确认一下这两个账号最近的实际调用模式（量级、是否已有稳定并发水位），避免 10 这个数字定得比它们实际需要的更紧或更松。

## 已确认（不再是未决）
- 三档划分：豁免 / 硬顶10+reject（Barry、image-service、zhengwu.liu）/ 排队5+queue300s（其余 oidc_ 账号）。
- 非 oidc_ 前缀的 default 组账号（admin/alan2/1111/222/jack/ctfwulala）豁免。
- 不按模型排除（文本+出图统一计数）。

## 风险
- slot 泄漏 → ZSET maxAge 自愈兜底（2h）。
- check-then-add 竞态 → Lua 原子消除。
- 排队档轮询实现不当可能造成 goroutine/连接泄漏 → 必须用 `context.WithTimeout` + 监听 client 断开，测试计划第7条专门验证。
- 排队档 300s 等待期间，如果客户端本身有更短的 HTTP 超时（比如 Codex CLI 默认超时可能小于 300s），会在服务端还在排队时客户端先超时断连——需要观察验证计划第7条覆盖的场景。
- 豁免误配 → 按 user_id 精确豁免，不影响计费 group。
- 部署需重构建 new-api：改动集中在 relay 入口，不碰 billing/schema，面小。
