<script setup>
/**
 * 仪表盘：每块 GPU 一张卡片（利用率/显存/功耗/风扇/编解码 + 温度迷你曲线 + ECC 状态）
 */
import { computed, ref, watch } from 'vue'
import { latestSnapshot, store } from '../store'
import RealTimeChart from '../components/RealTimeChart.vue'

const gpus = computed(() => (latestSnapshot.value && latestSnapshot.value.gpus) || [])

// 实时曲线跟随选中的 GPU
const chartGpu = ref(0)
const chartSeries = computed(() => store.series[chartGpu.value] || [])
watch(gpus, (list) => {
  if (list.length && !list.some((g) => g.index === chartGpu.value)) chartGpu.value = list[0].index
})

function barColor(v) {
  if (v >= 90) return 'var(--danger)'
  if (v >= 70) return 'var(--warn)'
  return 'var(--accent)'
}
function tempColor(t) {
  if (t >= 85) return 'var(--danger)'
  if (t >= 70) return 'var(--warn)'
  return 'var(--ok)'
}
function eccBadge(g) {
  const e = g.ecc
  if (!e) return null
  if (e.uncorrectedAggregate > 0) return { text: 'ECC FAIL', cls: 'fail' }
  if (e.correctedAggregate > 0) return { text: `ECC 已纠正 ${e.correctedAggregate}`, cls: 'warn' }
  return { text: 'ECC PASS', cls: 'pass' }
}
function pct(v) {
  return Math.min(100, Math.max(0, v))
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2>仪表盘</h2>
      <span class="text-secondary" v-if="latestSnapshot">更新于 {{ new Date(latestSnapshot.ts).toLocaleTimeString('zh-CN') }} · {{ latestSnapshot.basicMode ? '基础模式（老驱动）' : '完整模式' }}</span>
    </div>

    <el-empty v-if="!gpus.length && store.connected" description="正在等待第一次数据…" />
    <el-alert v-if="!store.connected" type="error" :title="'采集失败：' + store.errorMsg" show-icon style="margin-bottom: 14px" />

    <div class="dash">
      <div class="cards">
        <div v-for="g in gpus" :key="g.index" class="card gpu-card">
        <div class="gpu-head">
          <div>
            <span class="gpu-name">GPU {{ g.index }}</span>
            <span class="gpu-model">{{ g.name }}</span>
          </div>
          <el-tag v-if="eccBadge(g)" :type="eccBadge(g).cls === 'fail' ? 'danger' : eccBadge(g).cls === 'warn' ? 'warning' : 'success'" size="small" effect="dark">
            {{ eccBadge(g).text }}
          </el-tag>
        </div>

        <div class="temp-block">
          <span class="temp-num" :style="{ color: tempColor(g.temperatureGpu) }">{{ Math.round(g.temperatureGpu) }}<small>°C</small></span>
          <div class="temp-side">
            <div class="text-secondary small">核心 {{ g.clocksGraphics }} / {{ g.clocksMaxGraphics }} MHz</div>
            <div class="text-secondary small">显存 {{ g.clocksMemory }} / {{ g.clocksMaxMemory }} MHz</div>
            <div class="text-secondary small">P状态 {{ g.pstate }}</div>
          </div>
        </div>


        <div class="metric-row">
          <span class="metric-label">GPU利用率</span>
          <div class="metric-bar"><div class="metric-fill" :style="{ width: pct(g.utilization) + '%', background: barColor(g.utilization) }"></div></div>
          <span class="metric-value num">{{ g.utilization }}%</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">显存占用</span>
          <div class="metric-bar"><div class="metric-fill" :style="{ width: pct(g.memoryUsedPercent) + '%', background: barColor(g.memoryUsedPercent) }"></div></div>
          <span class="metric-value num">{{ g.memoryUsed }}/{{ g.memoryTotal }}M</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">功耗</span>
          <div class="metric-bar"><div class="metric-fill" :style="{ width: pct(g.powerLimit > 0 ? (g.powerDraw / g.powerLimit) * 100 : 0) + '%', background: barColor(g.powerLimit > 0 ? (g.powerDraw / g.powerLimit) * 100 : 0) }"></div></div>
          <span class="metric-value num">{{ g.powerDraw }}W</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">风扇转速</span>
          <div class="metric-bar"><div class="metric-fill" :style="{ width: pct(g.fanSpeed) + '%', background: barColor(g.fanSpeed) }"></div></div>
          <span class="metric-value num">{{ g.fanSpeed }}%</span>
        </div>
        <div class="metric-row" v-if="!latestSnapshot?.basicMode">
          <span class="metric-label">编码/解码</span>
          <div class="metric-bar"><div class="metric-fill" :style="{ width: pct(Math.max(g.utilizationEnc, g.utilizationDec)) + '%' }"></div></div>
          <span class="metric-value num">E{{ g.utilizationEnc }}% D{{ g.utilizationDec }}%</span>
        </div>
        </div>
      </div>

      <!-- 右侧实时曲线面板 -->
      <div class="card live-panel">
        <div class="panel-head" v-if="gpus.length > 1">
          <el-select v-model="chartGpu" size="small" style="width: 100%">
            <el-option v-for="g in gpus" :key="g.index" :label="`GPU ${g.index} · ${g.name}`" :value="g.index" />
          </el-select>
        </div>
        <div class="panel-head" v-else-if="gpus.length === 1">
          <span class="panel-gpu">GPU {{ gpus[0].index }} · {{ gpus[0].name }}</span>
        </div>
        <RealTimeChart :series="chartSeries" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.page-head h2 {
  margin: 0;
  font-size: 20px;
}
.dash {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.cards {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}
.live-panel {
  width: 440px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: calc(100vh - 130px);
  min-height: 420px;
  display: flex;
  flex-direction: column;
  padding: 14px 14px 10px;
}
.panel-head {
  margin-bottom: 8px;
}
.panel-gpu {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}
@media (max-width: 1020px) {
  .dash {
    flex-direction: column;
  }
  .live-panel {
    width: 100%;
    position: static;
    height: 400px;
  }
}
.gpu-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.gpu-name {
  font-size: 15px;
  font-weight: 700;
  margin-right: 8px;
  color: var(--accent);
}
.gpu-model {
  font-size: 13px;
  color: var(--text-secondary);
}
.temp-block {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 4px 0 2px;
}
.temp-num {
  font-size: 42px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.temp-num small {
  font-size: 16px;
  font-weight: 500;
}
.temp-side {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.small {
  font-size: 12px;
}
</style>
