<script setup>
/**
 * 迷你温度曲线（ECharts 按需引入，节流更新）
 */
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, CanvasRenderer])

const props = defineProps({
  series: { type: Array, default: () => [] }, // [{t, temp}]
  color: { type: String, default: '#58a6ff' },
  height: { type: Number, default: 90 }
})

const el = ref(null)
let chart = null
let lastRender = 0

function render(force) {
  if (!chart) return
  const now = Date.now()
  if (!force && now - lastRender < 5000) return // 5 秒节流
  lastRender = now
  const data = props.series.slice(-300) // 最多画 300 点
  chart.setOption(
    {
      animation: false,
      grid: { left: 6, right: 6, top: 6, bottom: 6 },
      xAxis: { type: 'category', show: false, data: data.map((d) => d.t) },
      yAxis: { type: 'value', show: false, min: 0, max: 110 },
      series: [
        {
          type: 'line',
          data: data.map((d) => [d.t, d.temp]),
          showSymbol: false,
          lineStyle: { width: 1.5, color: props.color },
          areaStyle: { color: props.color, opacity: 0.12 }
        }
      ]
    },
    { lazyUpdate: true }
  )
}

onMounted(() => {
  chart = echarts.init(el.value)
  render(true)
  window.addEventListener('resize', resize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  if (chart) chart.dispose()
  chart = null
})
function resize() {
  if (chart) chart.resize()
}
watch(() => props.series.length, () => render(false))
</script>

<template>
  <div ref="el" :style="{ height: height + 'px', width: '100%' }"></div>
</template>
