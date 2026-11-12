'use strict'
/**
 * GPU 数据采集器：封装 nvidia-smi 的所有查询与解析
 * 采用分层查询：扩展指标失败时自动降级到基础指标，保证老驱动也能用
 */
import { execFile } from "child_process"

const SMI = process.platform === 'win32' ? 'nvidia-smi' : 'nvidia-smi'

function smi(args) {
  return new Promise((resolve, reject) => {
    execFile(
      SMI,
      args,
      { windowsHide: true, timeout: 10000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).trim()))
        else resolve(String(stdout))
      }
    )
  })
}

/** 解析单行 CSV；若末尾字段自带逗号（如 throttle reasons），并入最后一个字段 */
function parseLine(line, expected) {
  const parts = line.split(',').map((v) => v.trim())
  if (parts.length > expected) {
    const overflow = parts.slice(expected - 1).join(',')
    parts.length = expected - 1
    parts.push(overflow)
  }
  return parts
}

function num(v) {
  if (v === undefined || v === null) return 0
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

// ---- 查询字段 ----
// 扩展指标：利用率细分/编解码/显存温度/PCIe/功耗限制/P状态
const EXTENDED_QUERY = [
  'index', 'name',
  'utilization.gpu', 'utilization.memory', 'utilization.encoder', 'utilization.decoder',
  'temperature.gpu', 'temperature.memory', 'fan.speed',
  'memory.used', 'memory.total',
  'clocks.current.graphics', 'clocks.max.graphics', 'clocks.current.memory', 'clocks.max.memory',
  'power.draw', 'power.default_limit', 'power.max_limit', 'power.min_limit',
  'pstate',
  'pcie.link.gen.current', 'pcie.link.gen.max', 'pcie.link.width.current', 'pcie.link.width.max'
].join(',')
const EXTENDED_COLS = 24

// 基础降级查询（对应原版 GPU-J 的字段 + ecc）
const BASIC_QUERY = [
  'index', 'name', 'utilization.gpu', 'temperature.gpu', 'temperature.memory', 'fan.speed',
  'memory.used', 'memory.total',
  'clocks.current.graphics', 'clocks.max.graphics', 'clocks.current.memory', 'clocks.max.memory',
  'power.draw', 'power.default_limit',
  'ecc.errors.corrected.volatile.total', 'ecc.errors.corrected.aggregate.total',
  'ecc.errors.uncorrected.volatile.total', 'ecc.errors.uncorrected.aggregate.total',
  'retired_pages.single_bit_ecc.count', 'retired_pages.double_bit.count', 'retired_pages.pending'
].join(',')
const BASIC_COLS = 21

// ECC 专项查询（扩展模式下单独拉取，部分显卡不支持）
const ECC_QUERY = [
  'index',
  'ecc.errors.corrected.volatile.total', 'ecc.errors.corrected.aggregate.total',
  'ecc.errors.uncorrected.volatile.total', 'ecc.errors.uncorrected.aggregate.total',
  'retired_pages.single_bit_ecc.count', 'retired_pages.double_bit.count', 'retired_pages.pending'
].join(',')
const ECC_COLS = 8

// 静态信息（启动时查询一次）
const STATIC_QUERY = [
  'index', 'name', 'driver_version', 'vbios_version', 'serial', 'uuid',
  'compute_cap', 'power.default_limit', 'power.max_limit', 'power.min_limit', 'memory.total'
].join(',')
const STATIC_COLS = 11

function parseEccFields(volatileC, aggregateC, volatileU, aggregateU, singleBit, doubleBit, pending) {
  const n = (v) => (Number.isFinite(parseInt(v)) ? parseInt(v) : 0)
  const pendingStr = String(pending || '').toUpperCase()
  return {
    correctedVolatile: n(volatileC),
    correctedAggregate: n(aggregateC),
    uncorrectedVolatile: n(volatileU),
    uncorrectedAggregate: n(aggregateU),
    singleBit: n(singleBit),
    doubleBit: n(doubleBit),
    pendingRetirement: !(pendingStr.includes('N/A') || pendingStr === 'NO' || pendingStr === '')
  }
}

class Collector {
  constructor() {
    this.basicMode = false // 扩展查询失败后置 true
    this.eccAvailable = true
    this.staticInfo = null
    this.lastSnapshot = null
  }

  /** 启动时获取静态信息，失败不阻塞 */
  async loadStatic() {
    try {
      const out = await smi(['--query-gpu=' + STATIC_QUERY, '--format=csv,noheader,nounits'])
      this.staticInfo = out.trim().split('\n').filter(Boolean).map((line) => {
        const p = parseLine(line, STATIC_COLS)
        return {
          index: num(p[0]),
          name: p[1],
          driverVersion: p[2],
          vbiosVersion: p[3],
          serial: p[4],
          uuid: p[5],
          computeCap: p[6],
          powerDefaultLimit: num(p[7]),
          powerMaxLimit: num(p[8]),
          powerMinLimit: num(p[9]),
          memoryTotal: num(p[10])
        }
      })
    } catch (e) {
      this.staticInfo = null
    }
    return this.staticInfo
  }

  /** 每次轮询的主查询 */
  async pollGpus() {
    if (!this.basicMode) {
      try {
        return this.parseExtended(await smi(['--query-gpu=' + EXTENDED_QUERY, '--format=csv,noheader,nounits']))
      } catch (e) {
        this.basicMode = true // 老驱动/虚拟机，降级
      }
    }
    return this.parseBasic(await smi(['--query-gpu=' + BASIC_QUERY, '--format=csv,noheader,nounits']))
  }

  parseExtended(out) {
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const p = parseLine(line, EXTENDED_COLS)
      const memTotal = num(p[10]) || 1
      return {
        index: num(p[0]),
        name: p[1],
        utilization: num(p[2]),
        utilizationMemory: num(p[3]),
        utilizationEnc: num(p[4]),
        utilizationDec: num(p[5]),
        temperatureGpu: num(p[6]),
        temperatureMemory: num(p[7]),
        fanSpeed: num(p[8]),
        memoryUsed: num(p[9]),
        memoryTotal: num(p[10]),
        memoryUsedPercent: +((num(p[9]) / memTotal) * 100).toFixed(2),
        clocksGraphics: num(p[11]),
        clocksMaxGraphics: num(p[12]),
        clocksMemory: num(p[13]),
        clocksMaxMemory: num(p[14]),
        powerDraw: num(p[15]),
        powerLimit: num(p[16]),
        powerMaxLimit: num(p[17]),
        powerMinLimit: num(p[18]),
        pstate: p[19] || 'N/A',
        pcieGenCurrent: num(p[20]),
        pcieGenMax: num(p[21]),
        pcieWidthCurrent: num(p[22]),
        pcieWidthMax: num(p[23])
      }
    })
  }

  parseBasic(out) {
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const p = parseLine(line, BASIC_COLS)
      const memTotal = num(p[7]) || 1
      const ecc = parseEccFields(p[14], p[15], p[16], p[17], p[18], p[19], p[20])
      const gpu = {
        index: num(p[0]),
        name: p[1],
        utilization: num(p[2]),
        utilizationMemory: 0,
        utilizationEnc: 0,
        utilizationDec: 0,
        temperatureGpu: num(p[3]),
        temperatureMemory: num(p[4]),
        fanSpeed: num(p[5]),
        memoryUsed: num(p[6]),
        memoryTotal: num(p[7]),
        memoryUsedPercent: +((num(p[6]) / memTotal) * 100).toFixed(2),
        clocksGraphics: num(p[8]),
        clocksMaxGraphics: num(p[9]),
        clocksMemory: num(p[10]),
        clocksMaxMemory: num(p[11]),
        powerDraw: num(p[12]),
        powerLimit: num(p[13]),
        powerMaxLimit: 0,
        powerMinLimit: 0,
        pstate: 'N/A',
        pcieGenCurrent: 0,
        pcieGenMax: 0,
        pcieWidthCurrent: 0,
        pcieWidthMax: 0,
        ecc
      }
      return gpu
    })
  }

  /** ECC 专项（扩展模式下补充） */
  async pollEcc() {
    if (!this.eccAvailable) return null
    try {
      const out = await smi(['--query-gpu=' + ECC_QUERY, '--format=csv,noheader,nounits'])
      const map = {}
      out.trim().split('\n').filter(Boolean).forEach((line) => {
        const p = parseLine(line, ECC_COLS)
        map[p[0]] = parseEccFields(p[1], p[2], p[3], p[4], p[5], p[6], p[7])
      })
      return map
    } catch (e) {
      this.eccAvailable = false
      return null
    }
  }

  /** 进程级占用：优先 pmon（含图形应用），失败退回 compute-apps */
  async pollProcesses() {
    try {
      const out = await smi(['pmon', '-c', '1', '-s', 'um'])
      const procs = []
      for (const line of out.split('\n')) {
        if (line.startsWith('#') || !line.trim()) continue
        const f = line.trim().split(/\s+/)
        if (f.length < 9) continue
        procs.push({
          gpu: num(f[0]),
          pid: num(f[1]),
          type: f[2] === 'C' ? '计算' : '图形',
          sm: num(f[3]),
          mem: num(f[4]),
          enc: num(f[5]),
          dec: num(f[6]),
          fb: num(f[7]),
          name: f.slice(8).join(' ')
        })
      }
      if (procs.length) return procs
    } catch (e) { /* 落到备用方案 */ }
    try {
      const out = await smi(['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits'])
      return out.trim().split('\n').filter(Boolean).map((line) => {
        const f = line.split(',').map((v) => v.trim())
        return {
          gpu: -1,
          pid: num(f[0]),
          type: '计算',
          sm: 0,
          mem: 0,
          enc: 0,
          dec: 0,
          fb: num(f[2]),
          name: f[1] || 'unknown'
        }
      })
    } catch (e) {
      return []
    }
  }

  /** 组装一次完整快照 */
  async snapshot() {
    const gpus = await this.pollGpus()
    if (!this.basicMode) {
      const eccMap = await this.pollEcc()
      if (eccMap) {
        for (const g of gpus) g.ecc = eccMap[g.index] || parseEccFields(0, 0, 0, 0, 0, 0, 'N/A')
      }
    }
    const processes = await this.pollProcesses()
    this.lastSnapshot = {
      ts: Date.now(),
      gpus,
      processes,
      basicMode: this.basicMode
    }
    return this.lastSnapshot
  }
}

export { Collector }
