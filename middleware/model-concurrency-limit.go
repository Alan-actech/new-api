package middleware

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

// concurrencyAcquireScript 原子地检查并占用一组 ZSET 槽位（all-or-nothing）。
// KEYS: 需要同时占用的 key 列表（普通请求 1 个，命中图片子限额的请求 2 个）。
// ARGV[1] = now (epoch seconds), ARGV[2] = maxAge (秒，用于清理卡死的旧 slot),
// ARGV[3] = requestId, ARGV[4..] = 与 KEYS 一一对应的 limit。
var concurrencyAcquireScript = redis.NewScript(`
local now = tonumber(ARGV[1])
local maxAge = tonumber(ARGV[2])
local reqId = ARGV[3]
local n = #KEYS
for i = 1, n do
	redis.call('ZREMRANGEBYSCORE', KEYS[i], 0, now - maxAge)
end
for i = 1, n do
	local limit = tonumber(ARGV[3 + i])
	local cur = redis.call('ZCARD', KEYS[i])
	if cur >= limit then
		return 0
	end
end
for i = 1, n do
	redis.call('ZADD', KEYS[i], now, reqId)
	redis.call('EXPIRE', KEYS[i], maxAge)
end
return 1
`)

const concurrencyMaxAgeSeconds = 7200 // 2h，覆盖实测最长任务时长；卡死 slot 自愈

// concurrencyPollInterval 排队档轮询间隔
const concurrencyPollInterval = 400 * time.Millisecond

func concurrencyKey(userId int) string {
	return fmt.Sprintf("concurrency:%d", userId)
}

func concurrencyImageKey(userId int) string {
	return fmt.Sprintf("concurrency:img:%d", userId)
}

// ---- Redis 实现 ----

func redisAcquireOnce(ctx context.Context, keys []string, limits []int, reqId string) (bool, error) {
	now := float64(time.Now().UnixNano()) / 1e9
	argv := make([]interface{}, 0, 3+len(limits))
	argv = append(argv, now, concurrencyMaxAgeSeconds, reqId)
	for _, l := range limits {
		argv = append(argv, l)
	}
	res, err := concurrencyAcquireScript.Run(ctx, common.RDB, keys, argv...).Int()
	if err != nil {
		return false, err
	}
	return res == 1, nil
}

func redisRelease(keys []string, reqId string) {
	ctx := context.Background()
	pipe := common.RDB.Pipeline()
	for _, k := range keys {
		pipe.ZRem(ctx, k, reqId)
	}
	_, _ = pipe.Exec(ctx)
}

// ---- 内存兜底实现（RedisEnabled=false 时，best-effort，无自愈） ----

var memConcurrencyMutex sync.Mutex
var memConcurrencyCounts = map[string]int{}

func memAcquireOnce(keys []string, limits []int) bool {
	memConcurrencyMutex.Lock()
	defer memConcurrencyMutex.Unlock()
	for i, k := range keys {
		if memConcurrencyCounts[k] >= limits[i] {
			return false
		}
	}
	for _, k := range keys {
		memConcurrencyCounts[k]++
	}
	return true
}

func memRelease(keys []string) {
	memConcurrencyMutex.Lock()
	defer memConcurrencyMutex.Unlock()
	for _, k := range keys {
		if memConcurrencyCounts[k] > 0 {
			memConcurrencyCounts[k]--
		}
	}
}

// ---- 统一 acquire/release ----

func acquireOnce(ctx context.Context, keys []string, limits []int, reqId string) (bool, error) {
	if common.RedisEnabled {
		return redisAcquireOnce(ctx, keys, limits, reqId)
	}
	return memAcquireOnce(keys, limits), nil
}

func releaseSlots(keys []string, reqId string) {
	if common.RedisEnabled {
		redisRelease(keys, reqId)
		return
	}
	memRelease(keys)
}

// acquireWithQueue 排队档：轮询直到成功、ctx 超时、或客户端断开。
func acquireWithQueue(ctx context.Context, keys []string, limits []int, reqId string, maxWait time.Duration) bool {
	deadlineCtx, cancel := context.WithTimeout(ctx, maxWait)
	defer cancel()

	ticker := time.NewTicker(concurrencyPollInterval)
	defer ticker.Stop()

	// 先尝试一次，避免空闲时也要等一个 tick
	if ok, err := acquireOnce(deadlineCtx, keys, limits, reqId); err == nil && ok {
		return true
	}

	for {
		select {
		case <-deadlineCtx.Done():
			return false
		case <-ticker.C:
			ok, err := acquireOnce(deadlineCtx, keys, limits, reqId)
			if err != nil {
				// Redis 异常时 fail-open，避免限流本身成为单点故障
				common.SysLog("concurrency limit acquire error, fail-open: " + err.Error())
				return true
			}
			if ok {
				return true
			}
		}
	}
}

// ModelConcurrencyLimit 每用户并发限制中间件。
// 与 ModelRequestRateLimit（每分钟请求次数）相互独立，紧挨在其后挂载。
func ModelConcurrencyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !setting.ModelConcurrencyLimitEnabled {
			c.Next()
			return
		}

		userId := c.GetInt("id")
		if setting.IsConcurrencyLimitExemptUser(userId) {
			c.Next()
			return
		}

		reqId := c.GetString(common.RequestIdKey)
		if reqId == "" {
			reqId = common.GetRandomString(16)
		}

		// 档位 1：用户级硬顶（reject，不排队）
		if limit, ok := setting.GetUserConcurrencyOverride(userId); ok {
			keys := []string{concurrencyKey(userId)}
			limits := []int{limit}
			allowed, err := acquireOnce(c.Request.Context(), keys, limits, reqId)
			if err != nil {
				common.SysLog("concurrency limit check error, fail-open: " + err.Error())
				c.Next()
				return
			}
			if !allowed {
				abortWithOpenAiMessage(c, http.StatusTooManyRequests,
					fmt.Sprintf("您已达到并发请求上限：最多同时 %d 个请求，请稍后重试", limit))
				return
			}
			defer releaseSlots(keys, reqId)
			c.Next()
			return
		}

		group := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
		if group == "" {
			group = common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		}

		// 档位 2：用户级排队上限覆盖（优先于组级，行为仍是排队，只是阈值单独调整）
		limit, ok := setting.GetUserQueueConcurrencyOverride(userId)
		if !ok {
			// 档位 3：组级排队上限
			limit, ok = setting.GetGroupConcurrencyLimit(group)
			if !ok {
				c.Next()
				return
			}
		}

		keys := []string{concurrencyKey(userId)}
		limits := []int{limit}

		// 图片生成子限额：命中时额外叠加一把更紧的锁，和总量锁一起原子占用
		if imgLimit, imgOk := setting.GetGroupImageConcurrencyLimit(group); imgOk {
			if mr, err := getModelFromRequest(c); err == nil && mr != nil && setting.IsImageModel(mr.Model) {
				keys = append(keys, concurrencyImageKey(userId))
				limits = append(limits, imgLimit)
			}
		}

		maxWait := time.Duration(setting.ModelConcurrencyLimitQueueMaxWaitSeconds) * time.Second
		if !acquireWithQueue(c.Request.Context(), keys, limits, reqId, maxWait) {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, "排队超时，请稍后重试")
			return
		}
		defer releaseSlots(keys, reqId)
		c.Next()
	}
}
