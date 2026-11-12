<script setup>
/**
 * 显卡详情页：静态信息 + 进程级占用 + PCIe + 功耗限制详情
 */
import { ref, onMounted, computed } from 'vue'
import { latestSnapshot } from '../store'
import { gpuApi } from '../composables/api'

const staticInfo = ref(null)
const selGpu = ref(0)

onMounted(async () => {
  staticInfo.value = await gpuApi.getStatic()
})

const gpus = computed(() => (latestSnapshot.value && latestSnapshot.value.gpus) || [])
const cur = computed(() => gpus.value.find((g) => g.index === selGpu.value) || gpus.value[0])
const curStatic = computed(() => (staticInfo.value || []).find((g) => g.index === selGpu.value))
const processes = computed(() => {
  const ps = (latestSnapshot.value && latestSnapshot.value.processes) || []
  return ps.filter((p) => p.gpu === selGpu.value || p.gpu === -1)
})

function genLabel(genCur, genMax) {
  if (!genCur) return 'N/A'
  return `Gen ${genCur}${genMax ? ' / 最高 Gen ' + genMax : ''}`
}
function widthLabel(wCur, wMax) {
  if (!wCur) return 'N/A'
  return `x${wCur}${wMax ? ' / 最高 x' + wMax : ''}`
}
function pcieSpeed(gen, width) {
  if (!gen || !width) return '—'
  const perGen = { 1: 250, 2: 500, 3: 985, 4: 1970, 5: 3940 }
  return ((perGen[gen] || 0) * width / 8).toFixed(1) + ' GB/s'
}
function pct(v) {
  return Math.min(100, Math.max(0, v))
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2>显卡详情</h2>
      <el-select v-model="selGpu" size="small" style="width: 220px" v-if="gpus.length">
        <el-option v-for="g in gpus" :key="g.index" :label="`GPU ${g.index} - ${g.name}`" :value="g.index" />
      </el-select>
    </div>

    <el-empty v-if="!cur" description="暂无数据" />

    <template v-else>
      <div class="detail-grid">
        <div class="card">
          <h3>静态信息</h3>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="型号">{{ curStatic?.name || cur.name }}</el-descriptions-item>
            <el-descriptions-item label="驱动版本">{{ curStatic?.driverVersion || '—' }}</el-descriptions-item>
            <el-descriptions-item label="VBIOS">{{ curStatic?.vbiosVersion || '—' }}</el-descriptions-item>
            <el-descriptions-item label="序列号">{{ curStatic?.serial || '—' }}</el-descriptions-item>
            <el-descriptions-item label="UUID">{{ curStatic?.uuid || '—' }}</el-descriptions-item>
            <el-descriptions-item label="计算能力">{{ curStatic?.computeCap || '—' }}</el-descriptions-item>
            <el-descriptions-item label="显存总量">{{ cur.memoryTotal }} MiB</el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="card">
          <h3>PCIe 链路</h3>
          <div class="kv"><span>当前世代</span><b>{{ genLabel(cur.pcieGenCurrent, cur.pcieGenMax) }}</b></div>
          <div class="kv"><span>当前带宽</span><b>{{ widthLabel(cur.pcieWidthCurrent, cur.pcieWidthMax) }}</b></div>
          <div class="kv"><span>理论带宽</span><b class="num">{{ pcieSpeed(cur.pcieGenCurrent, cur.pcieWidthCurrent) }}</b></div>
          <el-alert v-if="!cur.pcieGenCurrent" type="info" :closable="false" title="当前驱动不支持 PCIe 查询（基础模式）" style="margin-top: 10px" />
        </div>

        <div class="card">
          <h3>功耗详情</h3>
          <div class="metric-row">
            <span class="metric-label">当前功耗</span>
            <div class="metric-bar"><div class="metric-fill" :style="{ width: pct(cur.powerLimit > 0 ? (cur.powerDraw / cur.powerLimit) * 100 : 0) + '%' }"></div></div>
            <span class="metric-value num">{{ cur.powerDraw }} W</span>
          </div>
          <div class="kv-row"><span>默认上限</span><b class="num">{{ cur.powerLimit }} W</b></div>
          <div class="kv-row" v-if="cur.powerMaxLimit"><span>最大上限</span><b class="num">{{ cur.powerMaxLimit }} W</b></div>
          <div class="kv-row" v-if="cur.powerMinLimit"><span>最小上限</span><b class="num">{{ cur.powerMinLimit }} W</b></div>
          <div class="kv-row"><span>P 状态</span><b>{{ cur.pstate }}</b></div>
          <div class="text-secondary tip">功耗达到上限时 GPU 可能自动降频，可在仪表盘观察频率变化。</div>
        </div>

        <div class="card">
          <h3>编解码器利用率</h3>
          <div class="metric-row">
            <span class="metric-label">编码器 NVENC</span>
            <div class="metric-bar"><div class="metric-fill" :style="{ width: pct(cur.utilizationEnc) + '%' }"></div></div>
            <span class="metric-value num">{{ cur.utilizationEnc }}%</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">解码器 NVDEC</span>
            <div class="metric-bar"><div class="metric-fill" :style="{ width: pct(cur.utilizationDec) + '%' }"></div></div>
            <span class="metric-value num">{{ cur.utilizationDec }}%</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">显存带宽</span>
            <div class="metric-bar"><div class="metric-fill" :style="{ width: pct(cur.utilizationMemory) + '%', background: 'var(--accent-2)' }"></div></div>
            <span class="metric-value num">{{ cur.utilizationMemory }}%</span>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 16px">
        <h3>进程级占用（{{ processes.length }} 个）</h3>
        <el-table :data="processes" size="small" empty-text="当前没有进程在使用 GPU">
          <el-table-column prop="pid" label="PID" width="90" />
          <el-table-column prop="name" label="进程名" min-width="220" show-overflow-tooltip />
          <el-table-column prop="type" label="类型" width="80" />
          <el-table-column label="SM 占用%" width="100">
            <template #default="{ row }"><span class="num">{{ row.sm }}%</span></template>
          </el-table-column>
          <el-table-column label="显存占用 MiB" width="130">
            <template #default="{ row }"><span class="num">{{ row.fb || row.mem }}</span></template>
          </el-table-column>
          <el-table-column label="编码%" width="90">
            <template #default="{ row }"><span class="num">{{ row.enc }}%</span></template>
          </el-table-column>
          <el-table-column label="解码%" width="90">
            <template #default="{ row }"><span class="num">{{ row.dec }}%</span></template>
          </el-table-column>
        </el-table>
        <div class="text-secondary tip">提示：图形进程需要 pmon 支持；若列表为空但显存被占用，可能是旧版驱动不支持进程查询。</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}
.page-head h2 {
  margin: 0;
  font-size: 20px;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}
h3 {
  margin: 0 0 12px;
  font-size: 15px;
  color: var(--accent);
}
.kv {
  display: flex;
  justify-content: space-between;
  padding: 7px 0;
  font-size: 13px;
  border-bottom: 1px dashed var(--border);
}
.kv span { color: var(--text-secondary); }
.kv-row {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  font-size: 13px;
}
.kv-row span { color: var(--text-secondary); }
.tip {
  font-size: 12px;
  margin-top: 10px;
}
</style>
