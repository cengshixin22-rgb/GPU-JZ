'use strict'
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld('gpuApi', {
  // 数据
  getLatest: () => ipcRenderer.invoke('gpu:latest'),
  getStatic: () => ipcRenderer.invoke('gpu:static'),
  onSnapshot: (cb) => ipcRenderer.on('gpu:snapshot', (_e, snap) => cb(snap)),
  onError: (cb) => ipcRenderer.on('gpu:error', (_e, err) => cb(err)),
  // 告警
  onAlert: (cb) => ipcRenderer.on('alert:new', (_e, ev) => cb(ev)),
  recentAlerts: (limit) => ipcRenderer.invoke('alerts:recent', limit),
  clearAlerts: () => ipcRenderer.invoke('alerts:clear'),
  // 历史
  queryHistory: (opts) => ipcRenderer.invoke('history:query', opts),
  exportHistory: (opts) => ipcRenderer.invoke('history:export', opts),
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  pickWallpaper: () => ipcRenderer.invoke('app:pickWallpaper'),
  getSystemTheme: () => ipcRenderer.invoke('app:systemTheme')
})
