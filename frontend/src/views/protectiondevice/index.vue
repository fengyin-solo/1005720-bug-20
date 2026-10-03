<template>
  <section class="page" data-module="protectiondevice">
    <header class="page-head">
      <div>
        <h2>保护装置台账管理</h2>
        <p class="page-desc">维护保护装置，围绕装置编号、所属间隔、装置型号、保护类型做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记保护装置</button>
        <button class="btn" type="button" @click="exportRows">导出保护装置台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无保护装置台账数据，可先登记保护装置</td>
        </tr>
      </tbody>
    </table>

    <aside v-if="selectedRow" class="detail-panel" data-panel="protectiondevice-detail">
      <header class="detail-head">
        <h3>保护装置详情</h3>
        <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
      </header>
      <dl class="detail-grid">
        <template v-for="column in columns" :key="column">
          <dt>{{ column }}</dt>
          <dd>{{ selectedRow[column] || '—' }}</dd>
        </template>
        <dt>当前状态</dt>
        <dd>{{ selectedRow.status }}</dd>
      </dl>
      <p class="detail-note">详情与台账共用同一份底稿，装置型号、校验周期、上次校验日两边一致。</p>
    </aside>

    <footer class="page-foot">
      <span>共 {{ total }} 条保护装置台账记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('protectiondevice')
const columns = ["装置编号", "所属间隔", "装置型号", "保护类型", "投运日期", "校验周期", "上次校验日", "装置状态"]
const actions = ["登记运行", "完成校验", "提出更换"]
const statuses = ["待校验", "运行正常", "已校验", "需更换"]
const stats = [{"label": "运行正常装置", "value": 0}, {"label": "待校验装置", "value": 0}, {"label": "需更换装置", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedId = ref<number | null>(null)
// 详情面板和台账表格读的是同一份 rows，装置型号等字段两边自然是同一份。
const selectedRow = computed(
  () => rows.value.find((row) => Number(row.id) === selectedId.value) ?? null,
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '保护装置登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  selectedId.value = Number(row.id)
}

function closeDetail() {
  selectedId.value = null
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保护装置台账列表读取失败'
  }
}

onMounted(reload)
</script>
