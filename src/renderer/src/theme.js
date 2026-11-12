/**
 * 主题与壁纸应用逻辑
 */
import { gpuApi } from './composables/api'

export function resolveTheme(theme) {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return theme === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme) {
  const resolved = resolveTheme(theme)
  document.documentElement.dataset.theme = resolved
  // 同步 Element Plus 的深色模式（html.dark）
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export function applyWallpaper(wp) {
  let layer = document.getElementById('wallpaper-layer')
  if (!wp || !wp.enabled || !wp.path) {
    if (layer) layer.remove()
    return
  }
  if (!layer) {
    layer = document.createElement('div')
    layer.id = 'wallpaper-layer'
    document.body.insertBefore(layer, document.body.firstChild)
  }
  layer.style.backgroundImage = `url("file:///${wp.path.replace(/\\/g, '/')}")`
  layer.style.opacity = String(wp.opacity ?? 0.25)
  layer.style.filter = wp.blur ? `blur(${wp.blur}px)` : 'none'
}

/** 应用完整设置（主题 + 壁纸），并在系统主题变化时跟随 */
export function initTheme() {
  gpuApi.getSettings().then((s) => {
    if (!s) return
    applyTheme(s.theme)
    applyWallpaper(s.wallpaper)
  })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    const s = await gpuApi.getSettings()
    if (s && s.theme === 'system') applyTheme('system')
  })
}
