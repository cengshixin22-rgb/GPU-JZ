<script setup>
/**
 * 设置页：主题 / 壁纸 / 采集间隔 / 告警阈值 / 历史保留
 */
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { store } from '../store'
import { gpuApi } from '../composables/api'
import { applyTheme, applyWallpaper } from '../theme'

const emit = defineEmits(['settings-saved'])

const form = ref({
  theme: 'dark',
  wallpaper: { enabled: false, path: '', opacity: 0.25, blur: 0 },
  intervalMs: 2000,
  thresholds: { tempGpu: 85, tempMem: 95, memUsedPct: 95, powerPct: 100, eccUncorrected: 1 },
  retentionDays: 90
})
const saving = ref(false)

onMounted(() => {
  if (store.settings) form.value = JSON.parse(JSON.stringify(store.settings))
})

// 即时预览：切换主题/壁纸立即生效，点保存才持久化
watch(() => form.value.theme, (t) => applyTheme(t))
watch(
  () => ({ ...form.value.wallpaper }),
  (wp) => applyWallpaper(wp),
  { deep: true }
)

async function pickWallpaper() {
  const p = await gpuApi.pickWallpaper()
  if (p) {
    form.value.wallpaper.path = p
    form.value.wallpaper.enabled = true
  }
}

async function save() {
  saving.value = true
  try {
    // 必须转成普通对象：Vue 响应式代理无法通过 IPC 结构化克隆
    const payload = JSON.parse(JSON.stringify(form.value))
    const s = await gpuApi.setSettings(payload)
    store.settings = s
    emit('settings-saved', s)
    ElMessage.success('设置已保存并立即生效')
  } catch (e) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="settings">
    <h2>设置</h2>

    <div class="card section">
      <h3>外观</h3>
      <div class="form-row">
        <span class="label">界面主题</span>
        <el-radio-group v-model="form.theme">
          <el-radio-button value="dark">深色科技</el-radio-button>
          <el-radio-button value="light">浅色简洁</el-radio-button>
          <el-radio-button value="system">跟随系统</el-radio-button>
        </el-radio-group>
      </div>
      <div class="form-row">
        <span class="label">背景壁纸</span>
        <el-switch v-model="form.wallpaper.enabled" active-text="启用" />
      </div>
      <div class="form-row" v-if="form.wallpaper.enabled">
        <span class="label">壁纸文件</span>
        <el-input :model-value="form.wallpaper.path" readonly placeholder="未选择" style="flex: 1" size="small" />
        <el-button size="small" @click="pickWallpaper">选择图片</el-button>
      </div>
      <div class="form-row" v-if="form.wallpaper.enabled">
        <span class="label">壁纸不透明度 {{ Math.round(form.wallpaper.opacity * 100) }}%</span>
        <el-slider v-model="form.wallpaper.opacity" :min="0.05" :max="1" :step="0.05" style="flex: 1" />
      </div>
      <div class="form-row" v-if="form.wallpaper.enabled">
        <span class="label">壁纸模糊 {{ form.wallpaper.blur }}px</span>
        <el-slider v-model="form.wallpaper.blur" :min="0" :max="20" :step="1" style="flex: 1" />
      </div>
    </div>

    <div class="card section">
      <h3>采集</h3>
      <div class="form-row">
        <span class="label">采集间隔 {{ form.intervalMs / 1000 }} 秒</span>
        <el-slider v-model="form.intervalMs" :min="1000" :max="10000" :step="500" style="flex: 1" />
      </div>
      <div class="text-secondary tip">间隔越小实时性越好，但 nvidia-smi 调用越频繁；窗口失焦时自动降为 3 倍间隔以节省资源。</div>
      <div class="form-row" style="margin-top: 8px">
        <span class="label">历史保留 {{ form.retentionDays }} 天</span>
        <el-slider v-model="form.retentionDays" :min="7" :max="365" :step="1" style="flex: 1" />
      </div>
    </div>

    <div class="card section">
      <h3>告警阈值（仅应用内弹窗）</h3>
      <div class="form-row">
        <span class="label">GPU 温度 ≥ {{ form.thresholds.tempGpu }}°C</span>
        <el-slider v-model="form.thresholds.tempGpu" :min="60" :max="105" style="flex: 1" />
      </div>
      <div class="form-row">
        <span class="label">显存温度 ≥ {{ form.thresholds.tempMem }}°C</span>
        <el-slider v-model="form.thresholds.tempMem" :min="60" :max="110" style="flex: 1" />
      </div>
      <div class="form-row">
        <span class="label">显存占用 ≥ {{ form.thresholds.memUsedPct }}%</span>
        <el-slider v-model="form.thresholds.memUsedPct" :min="50" :max="100" style="flex: 1" />
      </div>
      <div class="form-row">
        <span class="label">功耗触顶 {{ form.thresholds.powerPct }}%</span>
        <el-slider v-model="form.thresholds.powerPct" :min="80" :max="100" style="flex: 1" />
      </div>
      <div class="text-secondary tip">同类告警有 60 秒冷却，不会刷屏；未纠正 ECC 错误始终立即告警。</div>
    </div>

    <div class="save-bar">
      <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
    </div>
  </div>
</template>

<style scoped>
.settings { max-width: 720px; }
h2 { margin: 0 0 16px; font-size: 20px; }
h3 { margin: 0 0 14px; font-size: 15px; color: var(--accent); }
.section { margin-bottom: 16px; padding: 16px; }
.form-row { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
.label { width: 220px; font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
.tip { font-size: 12px; }
.save-bar { margin-top: 6px; }
</style>
