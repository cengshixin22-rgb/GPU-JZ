/**
 * 全局响应式状态（不用 vuex/pinia，保持轻量）
 */
import { reactive, shallowRef } from 'vue'
import { gpuApi } from './composables/api'

export const store = reactive({
  page: 'dashboard',
  settings: null,
  staticInfo: null,
  connected: true,
  errorMsg: '',
  alerts: [],
  // 每块 GPU 的实时环形缓冲，用于迷你曲线（上限 600 点 ≈ 20 分钟 @2s）
  series: {} // { [gpuIndex]: [{t, temp, util, mem}] }
})

export const latestSnapshot = shallowRef(null)

const MAX_POINTS = 600

export function pushSnapshot(snap) {
  latestSnapshot.value = snap
  store.connected = true
  store.errorMsg = ''
  for (const g of snap.gpus) {
    if (!store.series[g.index]) store.series[g.index] = []
    const arr = store.series[g.index]
    arr.push({
      t: snap.ts,
      temp: g.temperatureGpu,
      tm: g.temperatureMemory,
      util: g.utilization,
      mem: g.memoryUsedPercent,
      power: g.powerDraw
    })
    if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS)
  }
}

export function pushError(err) {
  store.connected = false
  store.errorMsg = err.message || '数据采集失败'
}

export function pushAlert(ev) {
  store.alerts.unshift(ev)
  if (store.alerts.length > 200) store.alerts.pop()
}

/** 初始化：拉取设置/静态信息/告警历史，并订阅主进程推送 */
export async function initStore() {
  store.settings = await gpuApi.getSettings()
  store.staticInfo = await gpuApi.getStatic()
  store.alerts = await gpuApi.recentAlerts(100)
  gpuApi.onSnapshot(pushSnapshot)
  gpuApi.onError(pushError)
  gpuApi.onAlert(pushAlert)
}
