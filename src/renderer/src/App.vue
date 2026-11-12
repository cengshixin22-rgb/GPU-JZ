<script setup>
import { onMounted, computed } from 'vue'
import { ElNotification } from 'element-plus'
import { Monitor, Cpu, Clock, Warning, Setting, WarningFilled } from '@element-plus/icons-vue'
import { store, initStore, pushAlert } from './store'
import { applyTheme, applyWallpaper } from './theme'
import Dashboard from './pages/Dashboard.vue'
import GpuDetail from './pages/GpuDetail.vue'
import HistoryPage from './pages/HistoryPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import AlertsPage from './pages/AlertsPage.vue'

const pages = {
  dashboard: Dashboard,
  detail: GpuDetail,
  history: HistoryPage,
  alerts: AlertsPage,
  settings: SettingsPage
}

const pageComponent = computed(() => pages[store.page] || Dashboard)

onMounted(async () => {
  await initStore()
  // 应用内告警弹窗（用户选择：仅应用内提醒）
  let lastAlertTs = Date.now()
  // 把历史里比"本次启动"新的告警也弹一次？不需要——只弹新产生的
  store.alerts.forEach((a) => { if (a.ts > lastAlertTs) lastAlertTs = a.ts })
  window.gpuApi.onAlert((ev) => {
    pushAlert(ev)
    ElNotification({
      title: ev.level === 'critical' ? '严重告警' : ev.level === 'warning' ? '告警' : '提示',
      message: `[${ev.gpuName}] ${ev.message}`,
      type: ev.level === 'critical' ? 'error' : ev.level === 'warning' ? 'warning' : 'info',
      duration: ev.level === 'critical' ? 0 : 6000
    })
  })
})

async function onSettingsSaved(s) {
  store.settings = s
  applyTheme(s.theme)
  applyWallpaper(s.wallpaper)
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="logo">
        <span class="logo-badge">JZ</span>
        <span class="logo-text">GPU-JZ</span>
      </div>
      <nav class="nav">
        <div class="nav-item" :class="{ active: store.page === 'dashboard' }" @click="store.page = 'dashboard'">
          <el-icon><Monitor /></el-icon><span>仪表盘</span>
        </div>
        <div class="nav-item" :class="{ active: store.page === 'detail' }" @click="store.page = 'detail'">
          <el-icon><Cpu /></el-icon><span>显卡详情</span>
        </div>
        <div class="nav-item" :class="{ active: store.page === 'history' }" @click="store.page = 'history'">
          <el-icon><Clock /></el-icon><span>历史数据</span>
        </div>
        <div class="nav-item" :class="{ active: store.page === 'alerts' }" @click="store.page = 'alerts'">
          <el-icon><Warning /></el-icon><span>告警记录</span>
          <el-badge v-if="store.alerts.length" :value="Math.min(store.alerts.length, 99)" class="nav-badge" />
        </div>
        <div class="nav-item" :class="{ active: store.page === 'settings' }" @click="store.page = 'settings'">
          <el-icon><Setting /></el-icon><span>设置</span>
        </div>
      </nav>
      <div class="sidebar-footer text-secondary">
        <div v-if="store.connected" class="conn ok">● 采集中</div>
        <div v-else class="conn bad"><el-icon><WarningFilled /></el-icon> {{ store.errorMsg || '连接中断' }}</div>
      </div>
    </aside>

    <main class="content">
      <component :is="pageComponent" @settings-saved="onSettingsSaved" />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
  position: relative;
  z-index: 1;
}
.sidebar {
  width: 190px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  border-bottom: 1px solid var(--border);
}
.logo-badge {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}
.logo-text {
  font-weight: 600;
  font-size: 16px;
}
.nav {
  flex: 1;
  padding: 10px 8px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 14px;
  margin-bottom: 2px;
  position: relative;
}
.nav-item:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}
.nav-item.active {
  background: var(--bg-card-hover);
  color: var(--accent);
  font-weight: 600;
}
.nav-badge {
  position: absolute;
  right: 8px;
}
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.conn.ok { color: var(--ok); }
.conn.bad { color: var(--danger); word-break: break-all; }
.content {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}
</style>
