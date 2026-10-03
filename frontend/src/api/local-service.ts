import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 每个模块的底稿里都有一个和 status 对应的业务状态字段（装置状态、校验状态、检修状态……），
// 流转时两边写进同一条记录，列表、详情、导出读到的才是同一份。
function statusFieldOf(meta: ModuleMeta): string | null {
  const field = meta.fields.find((name) => name.endsWith('状态') || name.endsWith('结论'))
  return field ?? null
}

function todayString(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const sources = meta.actionSources?.[action]
  if (sources && !sources.includes(current)) {
    const terminal = meta.statuses[meta.statuses.length - 1]
    if (current === terminal) {
      return { ok: false, message: `${meta.entity}已是「${terminal}」，不允许再执行「${action}」` }
    }
    return {
      ok: false,
      message: `${meta.entity}当前状态「${current}」，不能越级执行「${action}」（需先流转到：${sources.join('、')}）`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 同一份底稿：业务状态字段跟着 status 落在同一条记录上。
  const statusField = statusFieldOf(meta)
  if (statusField) {
    updated[statusField] = target
  }
  applyRowEffects(key, action, updated)
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  const extra = applyCrossModuleEffects(key, action)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${extra}` }
}

// 动作落在本条记录上的附加写法：完成校验时把上次校验日写进同一份底稿，导出不再缺列。
function applyRowEffects(key: string, action: string, row: EntryRow): void {
  if (key === 'protectiondevice' && action === '完成校验') {
    row['上次校验日'] = todayString()
  }
}

// 跨模块回写：保护校验判定合格后，结论写进主变检修的待开工清单（只动待开工的记录）。
function applyCrossModuleEffects(key: string, action: string): string {
  if (key === 'relaytest' && action === '判定合格') {
    const maintMeta = moduleMeta('transformermaint')
    const rows = listRows('transformermaint')
    let touched = 0
    const next = rows.map((item) => {
      if (String(item.status) !== '待开工') {
        return item
      }
      touched += 1
      return { ...item, 检修状态: '校验合格' }
    })
    if (touched > 0) {
      saveRows('transformermaint', next)
      return `，校验合格结论已回写${maintMeta.name}待开工清单（${touched} 条）`
    }
    return `，${maintMeta.name}暂无待开工记录，结论未回写`
  }
  return ''
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
