<script setup>
/**
 * 告警记录页
 */
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { store } from '../store'
import { gpuApi } from '../composables/api'

const loading = ref(false)

async function clearAll() {
  await ElMessageBox.confirm('确定清空所有告警记录吗？', '提示', { type: 'warning' })
  loading.value = true
  try {
    await gpuApi.clearAlerts()
    store.alerts = []
    ElMessage.success('已清空')
  } finally {
    loading.value = false
  }
}

function fmtTs(ts) {
  return new Date(ts).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <div class="page-head">
      <h2>告警记录</h2>
      <el-button size="small" type="danger" plain :loading="loading" @click="clearAll">清空记录</el-button>
    </div>

    <el-table :data="store.alerts" size="small" empty-text="暂无告警，一切正常 🎉">
      <el-table-column label="时间" width="170">
        <template #default="{ row }"><span class="num">{{ fmtTs(row.ts) }}</span></template>
      </el-table-column>
      <el-table-column prop="gpuName" label="显卡" width="180" show-overflow-tooltip />
      <el-table-column label="级别" width="90">
        <template #default="{ row }">
          <el-tag :type="row.level === 'critical' ? 'danger' : row.level === 'warning' ? 'warning' : 'info'" size="small">
            {{ row.level === 'critical' ? '严重' : row.level === 'warning' ? '警告' : '提示' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="message" label="内容" min-width="300" />
    </el-table>
  </div>
</template>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-head h2 { margin: 0; font-size: 20px; }
</style>
