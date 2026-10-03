import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'substation-protection:entries'

// 底稿并轨：这些模块的业务状态字段必须和记录里的 status 保持一致。
// 老数据里两边可能脱节（校验完成了，底稿还写着待校验），读入时以 status 为准并轨，
// 之后列表、详情、导出读到的都是同一份。
const STATUS_MIRROR_FIELDS: Record<string, string> = {
  protectiondevice: '装置状态',
}

function mirrorStatusFields(rows: Record<string, EntryRow[]>): boolean {
  let changed = false
  for (const [key, field] of Object.entries(STATUS_MIRROR_FIELDS)) {
    for (const row of rows[key] ?? []) {
      const status = String(row.status ?? '')
      if (status && String(row[field] ?? '') !== status) {
        row[field] = status
        changed = true
      }
    }
  }
  return changed
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    mirrorStatusFields(fallback)
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    mirrorStatusFields(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    if (mirrorStatusFields(merged)) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
