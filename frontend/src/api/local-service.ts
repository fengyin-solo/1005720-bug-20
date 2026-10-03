import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 保护装置：装置状态、上次校验日、校验周期共用同一份台账底稿。
const PROTECTION_KEY = 'protectiondevice'
// 保护校验：同一台装置重复提交只保留一份底稿。
const RELAY_KEY = 'relaytest'
// 主变检修：校验合格结论回写到待开工清单。
const TRANSFORMER_KEY = 'transformermaint'
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function terminalStatuses(meta: ModuleMeta): string[] {
  return meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
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
  // 越级拦截：登记了源状态白名单的动作，只能从允许的状态发起。
  // 已提到需更换的装置因此不许再提交校验。
  const allowedFrom = meta.actionFrom?.[action]
  if (allowedFrom && !allowedFrom.includes(current)) {
    return { ok: false, message: `${meta.entity}当前为「${current}」，不能${action}（需先回到 ${allowedFrom.join('、')}）` }
  }

  // 保护校验：同一台装置重复「提交校验」只留一条底稿，落到已有的那一行上。
  if (key === RELAY_KEY && action === '提交校验') {
    const deviceName = String(rows[index]['装置名称'] ?? '')
    const occupied = rows.some(
      (row) => Number(row.id) !== id && String(row['装置名称'] ?? '') === deviceName,
    )
    if (occupied) {
      return { ok: false, message: `装置「${deviceName}」已有一份校验底稿，不能重复提交` }
    }
  }

  const updated = applyTransition(meta, rows[index], target, action)
  // 保护装置完成校验：上次校验日、装置状态一次落进同一行台账底稿。
  if (key === PROTECTION_KEY && action === '完成校验') {
    updated['上次校验日'] = today()
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  // 保护校验判定合格：合格结论回写到主变检修的待开工清单。
  if (key === RELAY_KEY && action === '判定合格') {
    writeBackTransformer(updated)
  }

  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 统一的状态流转：工作流状态与业务展示字段（如「装置状态」）一次写成同一份。
function applyTransition(meta: ModuleMeta, row: EntryRow, target: string, action: string): EntryRow {
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: !terminalStatuses(meta).includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (meta.statusField) {
    updated[meta.statusField] = target
  }
  return updated
}

// 同一台装置重复提交校验只留一条：已存在底稿就归并进那一行，否则新建一行。
export function submitRelayCheck(input: { deviceName: string; item: string; checker: string }): ActionResult {
  const meta = moduleMeta(RELAY_KEY)
  const rows = listRows(RELAY_KEY)
  const deviceName = input.deviceName.trim()
  if (!deviceName) {
    return { ok: false, message: '请先选择要校验的保护装置' }
  }
  // 同一台装置无论底稿在什么状态，重复提交都归并进同一行，绝不新增第二行。
  const active = rows.find((row) => String(row['装置名称'] ?? '') === deviceName)
  const checkDate = today()
  const patch: Record<string, string | number | boolean> = {
    '校验项目': input.item.trim() || '定期校验',
    '校验人': input.checker.trim() || '值班管理员',
    '校验日期': checkDate,
    '校验状态': '校验中',
  }
  if (active) {
    // 归并到同一份底稿：同一台装置不再新增第二行。
    const next = rows.map((row) => (row === active ? applyTransition(meta, { ...row, ...patch }, '校验中', '提交校验') : row))
    saveRows(RELAY_KEY, next)
    return { ok: true, message: `装置「${deviceName}」的校验底稿已更新，当前状态「校验中」` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const code = `RELA-${String(id).padStart(4, '0')}`
  const row: EntryRow = {
    id,
    status: '校验中',
    pending: true,
    abnormal: false,
    '校验编号': code,
    '装置名称': deviceName,
    '校验项目': patch['校验项目'] as string,
    '动作值': '',
    '返回值': '',
    '校验人': patch['校验人'] as string,
    '校验日期': checkDate,
    '校验状态': '校验中',
  }
  saveRows(RELAY_KEY, [...rows, row])
  return { ok: true, message: `装置「${deviceName}」已提交校验，当前状态「校验中」` }
}

// 从保护装置台账发起校验：已提到需更换的装置不许提交；校验底稿仍只留同一台装置那一条。
export function submitProtectionCheck(deviceId: number): ActionResult {
  const rows = listRows(PROTECTION_KEY)
  const device = rows.find((row) => Number(row.id) === deviceId)
  if (!device) {
    return { ok: false, message: `没有找到编号为 ${deviceId} 的保护装置` }
  }
  if (String(device.status) === '需更换') {
    return { ok: false, message: `装置「${device['装置编号']}」已标记需更换，先更换装置后再校验，不能越级提交` }
  }
  const deviceName = `${device['所属间隔'] ?? ''}${device['保护类型'] ?? ''}`
  return submitRelayCheck({ deviceName, item: '定期校验', checker: '值班管理员' })
}

// 校验合格 → 回写主变检修待开工清单：按间隔/主变名称对应，结论写进同一行的「校验结论」。
function writeBackTransformer(relayRow: EntryRow): void {
  const deviceName = String(relayRow['装置名称'] ?? '')
  const conclusion = `保护校验合格（${relayRow['校验编号'] ?? ''}，${relayRow['校验日期'] ?? today()}）`
  const rows = listRows(TRANSFORMER_KEY)
  let changed = false
  const next = rows.map((row) => {
    const isPending = String(row.status) === '待开工'
    const transformerName = String(row['主变名称'] ?? '')
    // 装置名与主变名按包含关系对应：如「1号主变差动保护」对应「1号主变」。
    const matched = deviceName.includes(transformerName) || transformerName.includes(deviceName)
    if (isPending && matched) {
      changed = true
      return { ...row, '校验结论': conclusion }
    }
    return row
  })
  if (changed) {
    saveRows(TRANSFORMER_KEY, next)
  }
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
