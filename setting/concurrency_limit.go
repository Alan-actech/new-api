package setting

import (
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// ModelConcurrencyLimit 按用户限制"同时在跑请求数"（并发数，非请求频率）。
// 与 ModelRequestRateLimit（每分钟请求次数）是两套独立机制，互不替代。
//
// 四档（按优先级）：
//  1. ExemptUserIds 命中 -> 不限。
//  2. UserOverride[userId] 命中 -> 该值为硬顶，超限直接拒绝（reject），不排队。
//  3. UserQueueOverride[userId] 命中 -> 该值为该用户专属排队上限（排队等待 QueueMaxWaitSeconds
//     秒，超时才 429），用于给个别 default 组用户单独调高/调低排队阈值而不改变其"排队"行为本身
//     （比如某用户量大但仍属正常人类用户，只是给他比 default 组更高的排队上限）。
//  4. Group[group] 命中 -> 该值为组级排队上限，行为同上。
//     排队档（3或4）内，若请求命中图片模型（ImageModelPrefixes 前缀），额外叠加一层更紧的
//     ImageGroup[group] 子限额（同样排队，共用同一个等待窗口）。
var ModelConcurrencyLimitEnabled = false
var ModelConcurrencyLimitGroup = map[string]int{}
var ModelConcurrencyLimitImageGroup = map[string]int{}
var ModelConcurrencyLimitUserOverride = map[int]int{}
var ModelConcurrencyLimitUserQueueOverride = map[int]int{}
var ModelConcurrencyLimitExemptUserIds = []int{}
var ModelConcurrencyLimitQueueMaxWaitSeconds = 300
var ModelConcurrencyLimitImageModelPrefixes = []string{"gpt-image"}

var ModelConcurrencyLimitMutex sync.RWMutex

func marshalOrEmpty(v any) string {
	jsonBytes, err := common.Marshal(v)
	if err != nil {
		common.SysLog("error marshalling concurrency limit setting: " + err.Error())
		return ""
	}
	return string(jsonBytes)
}

func ModelConcurrencyLimitGroup2JSONString() string {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	return marshalOrEmpty(ModelConcurrencyLimitGroup)
}

func ModelConcurrencyLimitImageGroup2JSONString() string {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	return marshalOrEmpty(ModelConcurrencyLimitImageGroup)
}

func ModelConcurrencyLimitUserOverride2JSONString() string {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	return marshalOrEmpty(ModelConcurrencyLimitUserOverride)
}

func ModelConcurrencyLimitUserQueueOverride2JSONString() string {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	return marshalOrEmpty(ModelConcurrencyLimitUserQueueOverride)
}

func ModelConcurrencyLimitExemptUserIds2JSONString() string {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	return marshalOrEmpty(ModelConcurrencyLimitExemptUserIds)
}

func UpdateModelConcurrencyLimitGroupByJSONString(jsonStr string) error {
	ModelConcurrencyLimitMutex.Lock()
	defer ModelConcurrencyLimitMutex.Unlock()
	m := make(map[string]int)
	if err := common.Unmarshal([]byte(jsonStr), &m); err != nil {
		return err
	}
	ModelConcurrencyLimitGroup = m
	return nil
}

func UpdateModelConcurrencyLimitImageGroupByJSONString(jsonStr string) error {
	ModelConcurrencyLimitMutex.Lock()
	defer ModelConcurrencyLimitMutex.Unlock()
	m := make(map[string]int)
	if err := common.Unmarshal([]byte(jsonStr), &m); err != nil {
		return err
	}
	ModelConcurrencyLimitImageGroup = m
	return nil
}

func UpdateModelConcurrencyLimitUserOverrideByJSONString(jsonStr string) error {
	ModelConcurrencyLimitMutex.Lock()
	defer ModelConcurrencyLimitMutex.Unlock()
	m := make(map[int]int)
	if err := common.Unmarshal([]byte(jsonStr), &m); err != nil {
		return err
	}
	ModelConcurrencyLimitUserOverride = m
	return nil
}

func UpdateModelConcurrencyLimitUserQueueOverrideByJSONString(jsonStr string) error {
	ModelConcurrencyLimitMutex.Lock()
	defer ModelConcurrencyLimitMutex.Unlock()
	m := make(map[int]int)
	if err := common.Unmarshal([]byte(jsonStr), &m); err != nil {
		return err
	}
	ModelConcurrencyLimitUserQueueOverride = m
	return nil
}

func UpdateModelConcurrencyLimitExemptUserIdsByJSONString(jsonStr string) error {
	ModelConcurrencyLimitMutex.Lock()
	defer ModelConcurrencyLimitMutex.Unlock()
	var ids []int
	if err := common.Unmarshal([]byte(jsonStr), &ids); err != nil {
		return err
	}
	ModelConcurrencyLimitExemptUserIds = ids
	return nil
}

func checkConcurrencyLimitMap(jsonStr string) error {
	m := make(map[string]int)
	if err := common.Unmarshal([]byte(jsonStr), &m); err != nil {
		return err
	}
	for k, v := range m {
		if v <= 0 || v > math.MaxInt32 {
			return fmt.Errorf("invalid concurrency limit for %s: %d", k, v)
		}
	}
	return nil
}

func CheckModelConcurrencyLimitGroup(jsonStr string) error {
	return checkConcurrencyLimitMap(jsonStr)
}

func CheckModelConcurrencyLimitImageGroup(jsonStr string) error {
	return checkConcurrencyLimitMap(jsonStr)
}

func CheckModelConcurrencyLimitUserOverride(jsonStr string) error {
	m := make(map[int]int)
	if err := common.Unmarshal([]byte(jsonStr), &m); err != nil {
		return err
	}
	for k, v := range m {
		if v <= 0 || v > math.MaxInt32 {
			return fmt.Errorf("invalid concurrency limit for user %d: %d", k, v)
		}
	}
	return nil
}

func CheckModelConcurrencyLimitUserQueueOverride(jsonStr string) error {
	m := make(map[int]int)
	if err := common.Unmarshal([]byte(jsonStr), &m); err != nil {
		return err
	}
	for k, v := range m {
		if v <= 0 || v > math.MaxInt32 {
			return fmt.Errorf("invalid concurrency limit for user %d: %d", k, v)
		}
	}
	return nil
}

func CheckModelConcurrencyLimitExemptUserIds(jsonStr string) error {
	var ids []int
	return common.Unmarshal([]byte(jsonStr), &ids)
}

// IsConcurrencyLimitExemptUser 用户是否豁免（不限并发）
func IsConcurrencyLimitExemptUser(userId int) bool {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	for _, id := range ModelConcurrencyLimitExemptUserIds {
		if id == userId {
			return true
		}
	}
	return false
}

// GetUserConcurrencyOverride 用户级硬顶（reject 档）
func GetUserConcurrencyOverride(userId int) (int, bool) {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	limit, ok := ModelConcurrencyLimitUserOverride[userId]
	return limit, ok
}

// GetUserQueueConcurrencyOverride 用户级排队上限覆盖（queue 档，优先于组级）
func GetUserQueueConcurrencyOverride(userId int) (int, bool) {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	limit, ok := ModelConcurrencyLimitUserQueueOverride[userId]
	return limit, ok
}

// GetGroupConcurrencyLimit 组级排队上限（queue 档）
func GetGroupConcurrencyLimit(group string) (int, bool) {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	limit, ok := ModelConcurrencyLimitGroup[group]
	return limit, ok
}

// GetGroupImageConcurrencyLimit 组级图片生成子限额（queue 档内嵌套的更紧限额）
func GetGroupImageConcurrencyLimit(group string) (int, bool) {
	ModelConcurrencyLimitMutex.RLock()
	defer ModelConcurrencyLimitMutex.RUnlock()
	limit, ok := ModelConcurrencyLimitImageGroup[group]
	return limit, ok
}

// IsImageModel 请求的模型是否命中图片生成前缀（大小写不敏感）
func IsImageModel(model string) bool {
	ModelConcurrencyLimitMutex.RLock()
	prefixes := ModelConcurrencyLimitImageModelPrefixes
	ModelConcurrencyLimitMutex.RUnlock()
	lower := strings.ToLower(model)
	for _, p := range prefixes {
		if strings.HasPrefix(lower, strings.ToLower(p)) {
			return true
		}
	}
	return false
}
