<script setup>
/**
 * 实时曲线面板：滚动时间窗，每秒刷新（数据每 2 秒采样一次）
 * 指标可切换：温度（GPU+显存双线）/ 利用率 / 显存占用 / 功耗
 */
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps({
  series: { type: Array, default: () => [] }
})

const metric = ref('temp')
const el = ref(null)
let chart = null
let timer = null
let observer = null

const METRICS = [
  { key: 'temp', label: '温度' },
  { key: 'util', label: '利用率' },
  { key: 'mem', label: '显存' },
  { key: 'power', label: '功耗' }
]

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function buildOption() {
  const data = props.series.slice(-300)
  const textColor = cssVar('--text-secondary', '#8b949e')
  const gridColor = cssVar('--border', '#2d3746')
  const isDark = document.documentElement.dataset.theme !== 'light'

  const baseSeries = {
    type: 'line',
    showSymbol: false,
    smooth: 0.25,
    animation: false,
    lineStyle: { width: 2 },
    emphasis: { focus: 'series' }
  }

  let series = []
  let yAxis = {}

  if (metric.value === 'temp') {
    series = [
      {
        ...baseSeries,
        name: 'GPU 温度',
        data: data.map((d) => [d.t, d.temp]),
        lineStyle: { width: 2, color: '#f85149' },
        itemStyle: { color: '#f85149' },
        areaStyle: { color: 'rgba(248,81,73,0.12)' }
      }
    ]
    // 消费级显卡通常不提供显存温度传感器，值为 0/N/A 时不画该曲线
    if (memTempAvailable.value) {
      series.push({
        ...baseSeries,
        name: '显存温度',
        data: data.map((d) => [d.t, d.tm]),
        lineStyle: { width: 2, color: '#bc8cff' },
        itemStyle: { color: '#bc8cff' },
        areaStyle: { color: 'rgba(188,140,255,0.10)' }
      })
    }
    yAxis = { type: 'value', min: 0, max: 110, name: '°C' }
  } else if (metric.value === 'util') {
    series = [
      {
        ...baseSeries,
        name: 'GPU 利用率',
        data: data.map((d) => [d.t, d.util]),
        lineStyle: { width: 2, color: '#58a6ff' },
        itemStyle: { color: '#58a6ff' },
        areaStyle: { color: 'rgba(88,166,255,0.14)' }
      }
    ]
    yAxis = { type: 'value', min: 0, max: 100, name: '%' }
  } else if (metric.value === 'mem') {
    series = [
      {
        ...baseSeries,
        name: '显存占用',
        data: data.map((d) => [d.t, d.mem]),
        lineStyle: { width: 2, color: '#d29922' },
        itemStyle: { color: '#d29922' },
        areaStyle: { color: 'rgba(210,153,34,0.14)' }
      }
    ]
    yAxis = { type: 'value', min: 0, max: 100, name: '%' }
  } else {
    series = [
      {
        ...baseSeries,
        name: '功耗',
        data: data.map((d) => [d.t, d.power]),
        lineStyle: { width: 2, color: '#3fb950' },
        itemStyle: { color: '#3fb950' },
        areaStyle: { color: 'rgba(63,185,80,0.14)' }
      }
    ]
    yAxis = { type: 'value', name: 'W' }
  }

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 46, right: 18, top: 14, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? 'rgba(22,27,34,0.95)' : 'rgba(255,255,255,0.97)',
      borderColor: gridColor,
      textStyle: { color: isDark ? '#e6edf3' : '#24292f', fontSize: 12 },
      formatter: (ps) =>
        new Date(ps[0].value[0]).toLocaleTimeString('zh-CN') +
        '<br/>' +
        ps.map((p) => `${p.marker}${p.seriesName}: <b>${p.value[1]}</b>`).join('<br/>')
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: gridColor } },
      axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
      splitLine: { show: false }
    },
    yAxis: {
      ...yAxis,
      nameTextStyle: { color: textColor, fontSize: 10 },
      axisLabel: { color: textColor, fontSize: 10 },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: gridColor, type: 'dashed', opacity: 0.5 } }
    },
    series
  }
}

function render() {
  if (!chart) return
  chart.setOption(buildOption(), { notMerge: true, lazyUpdate: true })
}

onMounted(() => {
  chart = echarts.init(el.value)
  render()
  timer = setInterval(render, 1000) // 每秒滚动刷新
  window.addEventListener('resize', onResize)
  // 主题切换时重绘（文字/网格颜色跟随主题）
  observer = new MutationObserver(render)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

function onResize() {
  if (chart) chart.resize()
}

onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('resize', onResize)
  if (observer) observer.disconnect()
  if (chart) chart.dispose()
  chart = null
})

watch(metric, render)

const empty = computed(() => props.series.length === 0)

// 是否支持显存温度（部分消费级显卡返回 N/A）
const memTempAvailable = computed(() => props.series.some((d) => d.tm > 0))

// 自绘图例
const legends = computed(() => {
  if (metric.value === 'temp') {
    const arr = [{ name: 'GPU 温度', color: '#f85149' }]
    if (memTempAvailable.value) arr.push({ name: '显存温度', color: '#bc8cff' })
    return arr
  }
  if (metric.value === 'util') return [{ name: 'GPU 利用率', color: '#58a6ff' }]
  if (metric.value === 'mem') return [{ name: '显存占用', color: '#d29922' }]
  return [{ name: '功耗', color: '#3fb950' }]
})
</script>

<template>
  <div class="live-chart">
    <div class="live-head">
      <span class="live-title">实时曲线</span>
      <div class="metric-switch">
        <span
          v-for="m in METRICS"
          :key="m.key"
          class="metric-tab"
          :class="{ active: metric === m.key }"
          @click="metric = m.key"
        >{{ m.label }}</span>
      </div>
    </div>
    <div class="chart-wrap">
      <div class="legend-row">
        <span v-for="l in legends" :key="l.name" class="lg-item">
          <i :style="{ background: l.color }"></i>{{ l.name }}
        </span>
        <span v-if="metric === 'temp' && !memTempAvailable" class="lg-note">此显卡不提供显存温度传感器</span>
      </div>
      <div ref="el" class="chart"></div>
      <div v-if="empty" class="empty-tip">等待数据采集…</div>
    </div>
    <div class="live-foot">最近 10 分钟 · 每 2 秒采样 · 滚动刷新</div>
  </div>
</template>

<style scoped>
.live-chart {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.live-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.live-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.metric-switch {
  display: flex;
  gap: 2px;
  background: var(--bg-card-hover);
  border-radius: 6px;
  padding: 2px;
}
.metric-tab {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 5px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: all 0.15s;
}
.metric-tab:hover {
  color: var(--text-primary);
}
.metric-tab.active {
  background: var(--accent);
  color: #fff;
}
.chart-wrap {
  position: relative;
  flex: 1;
  min-height: 300px;
}
.legend-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 2px 0 0 46px;
  height: 18px;
}
.lg-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}
.lg-item i {
  width: 14px;
  height: 3px;
  border-radius: 2px;
  display: inline-block;
}
.lg-note {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.75;
}
.chart {
  width: 100%;
  height: 100%;
  min-height: 300px;
}
.empty-tip {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-secondary);
}
.live-foot {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
  margin-top: 4px;
}
</style>
