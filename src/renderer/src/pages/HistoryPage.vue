<script setup>
/**
 * 历史数据页：按 GPU/指标/时间范围查询分钟级聚合数据，图表展示 + CSV 导出
 */
import { ref, onMounted, computed, nextTick } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { ElMessage } from 'element-plus'
import { latestSnapshot } from '../store'
import { gpuApi } from '../composables/api'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer])

const gpuIndex = ref(0)
const metric = ref('tu')
const range = ref([new Date(Date.now() - 86400000), new Date()])
const loading = ref(false)

const METRICS = [
  { key: 'tu', label: 'GPU 温度 (°C)', color: '#f85149' },
  { key: 'tm', label: '显存温度 (°C)', color: '#bc8cff' },
  { key: 'u', label: 'GPU 利用率 (%)', color: '#58a6ff' },
  { key: 'mu', label: '显存占用 (MiB)', color: '#d29922' },
  { key: 'pg', label: '功耗 (W)', color: '#3fb950' },
  { key: 'cg', label: '核心频率 (MHz)', color: '#39c5cf' },
  { key: 'cm', label: '显存频率 (MHz)', color: '#8b949e' },
  { key: 'enc', label: '编码器 (%)', color: '#e3b341' },
  { key: 'dec', label: '解码器 (%)', color: '#f778ba' }
]

const gpuOptions = computed(() => {
  const gs = (latestSnapshot.value && latestSnapshot.value.gpus) || []
  return gs.map((g) => ({ index: g.index, name: g.name }))
})

const el = ref(null)
let chart = null

async function load() {
  if (!range.value || range.value.length !== 2) return
  loading.value = true
  try {
    const from = new Date(range.value[0]); from.setHours(0, 0, 0, 0)
    const to = new Date(range.value[1]); to.setHours(23, 59, 59, 999)
    const rows = await gpuApi.queryHistory({ from: from.getTime(), to: to.getTime(), gpu: gpuIndex.value })
    await nextTick()
    if (!chart && el.value) chart = echarts.init(el.value)
    const m = METRICS.find((x) => x.key === metric.value)
    chart.setOption({
      animation: false,
      tooltip: {
        trigger: 'axis',
        formatter: (ps) => {
          const p = ps[0]
          return `${new Date(p.value[0]).toLocaleString('zh-CN')}<br/>${m.label}: <b>${p.value[1]}</b>`
        }
      },
      grid: { left: 50, right: 20, top: 30, bottom: 50 },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', name: m.label },
      dataZoom: [{ type: 'inside' }, { type: 'slider' }],
      series: [{ type: 'line', name: m.label, data: rows.map((r) => [r.ts, r[metric.value]]), showSymbol: false, lineStyle: { width: 1.5, color: m.color }, areaStyle: { color: m.color, opacity: 0.08 } }]
    }, true)
    if (!rows.length) ElMessage.info('所选范围内暂无历史数据')
  } finally {
    loading.value = false
  }
}

async function exportCsv() {
  const from = new Date(range.value[0]); from.setHours(0, 0, 0, 0)
  const to = new Date(range.value[1]); to.setHours(23, 59, 59, 999)
  const res = await gpuApi.exportHistory({ from: from.getTime(), to: to.getTime(), gpu: gpuIndex.value })
  if (res.ok) ElMessage.success(`已导出 ${res.count} 条到 ${res.path}`)
  else if (!res.canceled) ElMessage.error(res.message || '导出失败')
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h2>历史数据</h2>
      <span class="text-secondary">每分钟聚合一条 · 长期保存 · 可导出 CSV</span>
    </div>

    <div class="toolbar">
      <el-select v-model="gpuIndex" style="width: 200px">
        <el-option v-for="g in gpuOptions" :key="g.index" :label="`GPU ${g.index} - ${g.name}`" :value="g.index" />
      </el-select>
      <el-select v-model="metric" style="width: 170px" @change="load">
        <el-option v-for="m in METRICS" :key="m.key" :label="m.label" :value="m.key" />
      </el-select>
      <el-date-picker v-model="range" type="daterange" start-placeholder="开始日期" end-placeholder="结束日期" :clearable="false" style="width: 260px" @change="load" />
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
      <el-button @click="exportCsv">导出 CSV</el-button>
    </div>

    <div class="card chart-card">
      <div ref="el" style="height: 480px; width: 100%"></div>
    </div>
  </div>
</template>

<style scoped>
.page-head { margin-bottom: 14px; display: flex; align-items: baseline; gap: 12px; }
.page-head h2 { margin: 0; font-size: 20px; }
.toolbar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.chart-card { padding: 10px; }
</style>
