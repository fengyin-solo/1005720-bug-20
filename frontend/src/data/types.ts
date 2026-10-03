/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 业务表里与工作流状态同义的展示字段：每次流转都同步成同一个状态，台账与底稿只认这一份。
  statusField?: string
  // 动作允许的源状态白名单：不填则沿用「目标态不同就允许」的旧口径；填了就不许越级。
  actionFrom?: Record<string, string[]>
  // 终态集合：落在这些状态上的记录不再算待处理；不填时默认只有最后一个状态是终态。
  terminalStatuses?: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
