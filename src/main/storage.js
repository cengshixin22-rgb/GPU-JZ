'use strict'
/**
 * 历史数据存储：按天 JSONL 文件，零数据库依赖
 * - 采集层每 2s 产生快照，这里聚合为每 GPU 每分钟一条（均值），磁盘占用极小
 * - 目录: userData/history/YYYY-MM-DD.jsonl，一行一条 JSON
 * - 告警事件: userData/history/alerts.jsonl
 * - 支持按时间范围/GPU 过滤查询与 CSV 导出
 */
import fs from "fs"
import path from "path"

function dayKey(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function minuteKey(ts) {
  return Math.floor(ts / 60000) // 每分钟桶
}

class HistoryStore {
  constructor(dir) {
    this.dir = dir
    this.alertsFile = path.join(dir, 'alerts.jsonl')
    // 分钟聚合缓冲: { [gpuIndex]: { bucket, acc: {sum fields}, count } }
    this.buf = new Map()
    fs.mkdirSync(dir, { recursive: true })
  }

  fileFor(ts) {
    return path.join(this.dir, dayKey(ts) + '.jsonl')
  }

  /** 写入一条聚合后的分钟记录 */
  appendMinute(ts, gpuIndex, row) {
    const line = JSON.stringify({ ts, gpu: gpuIndex, ...row }) + '\n'
    fs.appendFile(this.fileFor(ts), line, (err) => {
      if (err) console.error('[history] append failed:', err.message)
    })
  }

  /**
   * 输入原始快照，内部做分钟聚合。
   * 内存中只保留当前分钟的累加值，不堆积。
   */
  feed(snapshot) {
    const bucket = minuteKey(snapshot.ts)
    for (const g of snapshot.gpus) {
      const cur = this.buf.get(g.index)
      if (!cur || cur.bucket !== bucket) {
        if (cur) this.flush(g.index, cur)
        this.buf.set(g.index, { bucket, acc: this.newAcc(), count: 0 })
      }
      const a = this.buf.get(g.index)
      a.count++
      a.acc.u += g.utilization || 0
      a.acc.tu += g.temperatureGpu || 0
      a.acc.tm += g.temperatureMemory || 0
      a.acc.fan += g.fanSpeed || 0
      a.acc.mu += g.memoryUsed || 0
      a.acc.mt += g.memoryTotal || 0
      a.acc.cg += g.clocksGraphics || 0
      a.acc.cm += g.clocksMemory || 0
      a.acc.pg += g.powerDraw || 0
      a.acc.enc += g.utilizationEnc || 0
      a.acc.dec += g.utilizationDec || 0
      a.acc.eccU = Math.max(a.acc.eccU, (g.ecc && g.ecc.uncorrectedAggregate) || 0)
      a.acc.eccC = Math.max(a.acc.eccC, (g.ecc && g.ecc.correctedAggregate) || 0)
    }
  }

  newAcc() {
    return { u: 0, tu: 0, tm: 0, fan: 0, mu: 0, mt: 0, cg: 0, cm: 0, pg: 0, enc: 0, dec: 0, eccU: 0, eccC: 0 }
  }

  flush(gpuIndex, cur) {
    const c = Math.max(cur.count, 1)
    const a = cur.acc
    const ts = cur.bucket * 60000
    this.appendMinute(ts, gpuIndex, {
      u: +(a.u / c).toFixed(1),
      tu: +(a.tu / c).toFixed(1),
      tm: +(a.tm / c).toFixed(1),
      fan: +(a.fan / c).toFixed(0),
      mu: +(a.mu / c).toFixed(0),
      mt: +(a.mt / c).toFixed(0),
      cg: +(a.cg / c).toFixed(0),
      cm: +(a.cm / c).toFixed(0),
      pg: +(a.pg / c).toFixed(1),
      enc: +(a.enc / c).toFixed(1),
      dec: +(a.dec / c).toFixed(1),
      eccU: a.eccU,
      eccC: a.eccC
    })
  }

  /** 立即冲刷当前未完成的分钟桶（程序退出前调用） */
  flushAll() {
    for (const [gpuIndex, cur] of this.buf) this.flush(gpuIndex, cur)
    this.buf.clear()
  }

  /** 按范围查询：{ from, to, gpu? } 返回分钟记录数组 */
  query({ from, to, gpu }) {
    const rows = []
    const startDay = dayKey(from)
    const endDay = dayKey(to)
    // 按天枚举文件（范围不会太大，保留天数有限）
    let d = new Date(startDay + 'T00:00:00')
    const end = new Date(endDay + 'T23:59:59')
    while (d <= end) {
      const f = this.fileFor(d.getTime())
      try {
        const text = fs.readFileSync(f, 'utf8')
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          try {
            const r = JSON.parse(line)
            if (r.ts >= from && r.ts <= to && (gpu === undefined || gpu === null || r.gpu === gpu)) {
              rows.push(r)
            }
          } catch (e) { /* 跳过坏行 */ }
        }
      } catch (e) { /* 文件不存在则跳过 */ }
      d.setDate(d.getDate() + 1)
    }
    rows.sort((a, b) => a.ts - b.ts)
    return rows
  }

  /** 记录告警事件 */
  appendAlert(event) {
    fs.appendFile(this.alertsFile, JSON.stringify(event) + '\n', () => {})
  }

  /** 读取最近 N 条告警 */
  recentAlerts(limit = 100) {
    try {
      const text = fs.readFileSync(this.alertsFile, 'utf8')
      const lines = text.split('\n').filter(Boolean)
      return lines.slice(-limit).map((l) => {
        try { return JSON.parse(l) } catch (e) { return null }
      }).filter(Boolean).reverse()
    } catch (e) {
      return []
    }
  }

  clearAlerts() {
    try { fs.unlinkSync(this.alertsFile) } catch (e) {}
  }

  /** 清理超过保留期的历史文件 */
  cleanup(retentionDays) {
    try {
      const files = fs.readdirSync(this.dir)
      const cutoff = Date.now() - retentionDays * 86400000
      for (const f of files) {
        const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/)
        if (!m) continue
        const t = new Date(m[1] + 'T23:59:59').getTime()
        if (t < cutoff) {
          fs.unlinkSync(path.join(this.dir, f))
        }
      }
    } catch (e) { /* 忽略 */ }
  }

  /** 导出 CSV（把查询结果写成文件） */
  exportCsv(rows, filePath) {
    const header = '时间,GPU索引,GPU利用率%,显存利用率%,编码器%,解码器%,GPU温度C,显存温度C,风扇%,显存已用MB,显存总MB,核心频率MHz,显存频率MHz,功耗W,ECC未纠正累计,ECC已纠正累计'
    const lines = [header]
    for (const r of rows) {
      lines.push([
        new Date(r.ts).toLocaleString('zh-CN'),
        r.gpu, r.u, '-', '-', '-',
        r.tu, r.tm, r.fan, r.mu, r.mt, r.cg, r.cm, r.pg,
        r.eccU, r.eccC
      ].join(','))
    }
    fs.writeFileSync(filePath, '\uFEFF' + lines.join('\n'), 'utf8') // BOM 保证 Excel 中文不乱码
    return filePath
  }
}

export { HistoryStore }
