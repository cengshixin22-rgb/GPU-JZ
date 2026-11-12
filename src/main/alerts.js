'use strict'
/**
 * 告警引擎：阈值判定 + 冷却去重
 * 仅生成应用内弹窗事件（用户选择：不做系统通知/声音）
 */

const DEFAULT_THRESHOLDS = {
  tempGpu: 85,      // GPU 温度 °C
  tempMem: 95,      // 显存温度 °C
  memUsedPct: 95,   // 显存占用 %
  powerPct: 100,    // 功耗达到默认上限 %
  fanMax: 100,      // 风扇异常（预留）
  eccUncorrected: 1 // 未纠正 ECC 错误数（>=1 即告警）
}

const COOLDOWN_MS = 60 * 1000 // 同类告警冷却 60s，防止刷屏

class AlertEngine {
  constructor() {
    this.cooldown = new Map() // key -> last ts
    this.lastEccU = new Map() // gpuIndex -> 上次未纠正累计值
  }

  /**
   * 评估快照，返回事件数组
   * 事件: { ts, gpu, gpuName, type, level, message, value, threshold }
   */
  evaluate(snapshot, thresholds) {
    const th = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) }
    const events = []
    const now = snapshot.ts
    const push = (gpu, type, level, message, value, threshold) => {
      const key = gpu.index + ':' + type
      const last = this.cooldown.get(key) || 0
      if (now - last < COOLDOWN_MS) return
      this.cooldown.set(key, now)
      events.push({
        ts: now,
        gpu: gpu.index,
        gpuName: gpu.name || 'GPU ' + gpu.index,
        type,
        level,
        message,
        value,
        threshold
      })
    }

    for (const g of snapshot.gpus) {
      // GPU 温度
      if (g.temperatureGpu >= th.tempGpu + 10) {
        push(g, 'tempGpu', 'critical', `GPU 温度过高 ${g.temperatureGpu}°C（阈值 ${th.tempGpu}°C）`, g.temperatureGpu, th.tempGpu)
      } else if (g.temperatureGpu >= th.tempGpu) {
        push(g, 'tempGpu', 'warning', `GPU 温度偏高 ${g.temperatureGpu}°C（阈值 ${th.tempGpu}°C）`, g.temperatureGpu, th.tempGpu)
      }
      // 显存温度
      if (g.temperatureMemory >= th.tempMem + 10) {
        push(g, 'tempMem', 'critical', `显存温度过高 ${g.temperatureMemory}°C（阈值 ${th.tempMem}°C）`, g.temperatureMemory, th.tempMem)
      } else if (g.temperatureMemory >= th.tempMem) {
        push(g, 'tempMem', 'warning', `显存温度偏高 ${g.temperatureMemory}°C（阈值 ${th.tempMem}°C）`, g.temperatureMemory, th.tempMem)
      }
      // 显存占用
      if (g.memoryUsedPercent >= th.memUsedPct) {
        push(g, 'memUsed', 'warning', `显存占用 ${g.memoryUsedPercent}%（${g.memoryUsed}/${g.memoryTotal} MiB）`, g.memoryUsedPercent, th.memUsedPct)
      }
      // 功耗触顶
      if (g.powerLimit > 0 && g.powerDraw >= g.powerLimit * (th.powerPct / 100)) {
        push(g, 'power', 'info', `功耗触顶 ${g.powerDraw}W / ${g.powerLimit}W（可能已降频）`, g.powerDraw, g.powerLimit)
      }
      // ECC：按累计值增长触发，不走冷却（新错误立即报）
      const eccU = (g.ecc && g.ecc.uncorrectedAggregate) || 0
      const prev = this.lastEccU.has(g.index) ? this.lastEccU.get(g.index) : null
      if (prev !== null && eccU > prev) {
        const diff = eccU - prev
        events.push({
          ts: now,
          gpu: g.index,
          gpuName: g.name || 'GPU ' + g.index,
          type: 'ecc',
          level: 'critical',
          message: `检测到 ${diff} 个新的未纠正 ECC 错误（累计 ${eccU}），请检查显存健康！`,
          value: eccU,
          threshold: th.eccUncorrected
        })
      }
      if (prev === null && eccU >= th.eccUncorrected) {
        events.push({
          ts: now,
          gpu: g.index,
          gpuName: g.name || 'GPU ' + g.index,
          type: 'ecc',
          level: 'critical',
          message: `检测到未纠正 ECC 错误（累计 ${eccU}），请检查显存健康！`,
          value: eccU,
          threshold: th.eccUncorrected
        })
      }
      this.lastEccU.set(g.index, eccU)
    }
    return events
  }

  reset() {
    this.cooldown.clear()
    this.lastEccU.clear()
  }
}

export { AlertEngine, DEFAULT_THRESHOLDS }
