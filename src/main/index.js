'use strict'
import { app, BrowserWindow, Menu, ipcMain, dialog, nativeTheme } from "electron"
import path from "path"
import fs from "fs"
import { exec } from "child_process"
import { Collector } from "./collector"
import { HistoryStore } from "./storage"
import { AlertEngine, DEFAULT_THRESHOLDS } from "./alerts"

let mainWindow = null
let pollTimer = null
let currentInterval = 2000

const collector = new Collector()
let store = null
const alertEngine = new AlertEngine()

// ---------- 设置 ----------
const DEFAULT_SETTINGS = {
  theme: 'dark',            // dark | light | system
  wallpaper: { enabled: false, path: '', opacity: 0.25, blur: 0 },
  intervalMs: 2000,         // 采集间隔
  thresholds: { ...DEFAULT_THRESHOLDS },
  retentionDays: 90         // 历史保留天数
}
let settings = null

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
  } catch (e) {
    settings = { ...DEFAULT_SETTINGS }
  }
  // 深合并阈值
  settings.thresholds = { ...DEFAULT_THRESHOLDS, ...(settings.thresholds || {}) }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8')
  } catch (e) {
    console.error('[settings] save failed:', e.message)
  }
}

// ---------- 轮询 ----------
async function pollOnce() {
  try {
    const snap = await collector.snapshot()
    store.feed(snap)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gpu:snapshot', snap)
    }
    const events = alertEngine.evaluate(snap, settings.thresholds)
    for (const ev of events) {
      store.appendAlert(ev)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('alert:new', ev)
      }
    }
  } catch (e) {
    // nvidia-smi 不可用时也推送错误状态，让界面显示提示
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gpu:error', { message: e.message })
    }
  }
}

function startPolling() {
  stopPolling()
  currentInterval = Math.max(1000, settings.intervalMs || 2000)
  pollTimer = setInterval(pollOnce, currentInterval)
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

/** 低占用优化：窗口失焦时自动降低采集频率（×3），聚焦恢复 */
function adjustPollingForFocus(focused) {
  if (!pollTimer) return
  stopPolling()
  const base = Math.max(1000, settings.intervalMs || 2000)
  pollTimer = setInterval(pollOnce, focused ? base : base * 3)
}

// ---------- 窗口 ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('focus', () => adjustPollingForFocus(true))
  mainWindow.on('blur', () => adjustPollingForFocus(false))
  mainWindow.on('closed', () => { mainWindow = null })
}

// ---------- 菜单（保留原版工具入口） ----------
function createAppMenu() {
  const openTerminal = (cmd) => {
    if (process.platform === 'win32') exec(`start powershell -NoExit -Command "${cmd}"`)
    else if (process.platform === 'darwin') exec(`osascript -e 'tell application "Terminal" to do script "${cmd}"'`)
    else exec(`bash -c "(x-terminal-emulator -e '${cmd}' || gnome-terminal -- ${cmd} || konsole -e ${cmd} || xterm -e ${cmd})"`)
  }
  const template = [
    {
      label: '工具',
      submenu: [
        { label: '查看GPU详情', click: () => openTerminal('nvidia-smi -q') },
        { label: '查看ECC详情', click: () => openTerminal('nvidia-smi -q -d ecc') },
        { label: '查看NVLINK', click: () => openTerminal('nvidia-smi nvlink -s') },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { label: '退出软件', click: () => app.quit() }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于软件',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: '关于软件',
              message: 'GPU-JZ v' + app.getVersion(),
              detail: 'GPU 运行状态监控 + ECC 错误检测\n\nFork 改进自 sertreet/GPU-J（MIT 协议）\n原作者：大白熊 / Bear\n\n新特性：主题/壁纸设置、进程级占用、PCIe/编解码监控、历史数据保存与导出、阈值告警',
              buttons: ['确定']
            })
        },
        { type: 'separator' },
        { role: 'quit', label: '退出（Quit）' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('gpu:latest', () => collector.lastSnapshot)
  ipcMain.handle('gpu:static', async () => {
    if (!collector.staticInfo) await collector.loadStatic()
    return collector.staticInfo
  })
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:set', (_e, next) => {
    const prevInterval = settings.intervalMs
    settings = { ...settings, ...next, thresholds: { ...DEFAULT_THRESHOLDS, ...(next.thresholds || {}) } }
    saveSettings()
    if (settings.intervalMs !== prevInterval) startPolling()
    return settings
  })
  ipcMain.handle('history:query', (_e, opts) => store.query(opts))
  ipcMain.handle('history:export', async (_e, opts) => {
    const rows = store.query(opts)
    if (!rows.length) return { ok: false, message: '所选范围内没有数据' }
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出历史数据 CSV',
      defaultPath: 'gpu-history-' + dayStr() + '.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    store.exportCsv(rows, res.filePath)
    return { ok: true, path: res.filePath, count: rows.length }
  })
  ipcMain.handle('alerts:recent', (_e, limit) => store.recentAlerts(limit))
  ipcMain.handle('alerts:clear', () => { store.clearAlerts(); return true })
  ipcMain.handle('app:pickWallpaper', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择背景壁纸',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })
  ipcMain.handle('app:systemTheme', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
}

function dayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

// ---------- 生命周期 ----------
app.whenReady().then(() => {
  loadSettings()
  store = new HistoryStore(path.join(app.getPath('userData'), 'history'))
  store.cleanup(settings.retentionDays)
  // 每天清理一次过期历史
  setInterval(() => store.cleanup(settings.retentionDays), 6 * 3600 * 1000)

  collector.loadStatic()
  registerIpc()
  createWindow()
  createAppMenu()
  startPolling()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopPolling()
  if (store) store.flushAll()
})
