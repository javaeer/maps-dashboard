/**
 * 业务数据集状态管理
 *
 * 阶段一职责：数据集列表的装载、导入落库、激活/停用、重命名、删除，
 * 以及给信息面板提供的「按 adcode 取记录」查询。
 * 阶段二会在此基础上扩展：面板 Tab 渲染、多数据集并行激活、导出 CSV。
 *
 * 所有写操作先落 IndexedDB 再同步内存 state，保证刷新页面后状态一致。
 */
import { defineStore } from 'pinia'
import * as db from '../utils/indexedDB.js'
import { uuid } from '../utils/dataParser.js'

export const useBusinessDataStore = defineStore('businessData', {
  state: () => ({
    /** @type {import('../utils/dataParser.js').BusinessDataSet[]} 全部数据集元信息 */
    dataSets: [],
    /** 是否已完成首次读取，避免重复请求 IndexedDB */
    loaded: false,
    loading: false,
    /** 最近一次操作的错误文案，供 UI 展示 */
    error: ''
  }),

  getters: {
    /** 已激活的数据集（面板按 Tab 展示） */
    activeSets: (s) => s.dataSets.filter((d) => d.isActive),
    /** 全部数据集记录总数 */
    totalRecords: (s) => s.dataSets.reduce((n, d) => n + (d.recordCount || 0), 0),
    /** 按 id 取元信息 */
    byId: (s) => (id) => s.dataSets.find((d) => d.id === id) || null
  },

  actions: {
    /**
     * 从 IndexedDB 装载数据集列表
     * @param {boolean} [force] 是否忽略缓存强制重读
     */
    async load(force = false) {
      if (this.loaded && !force) return this.dataSets
      this.loading = true
      this.error = ''
      try {
        this.dataSets = await db.listDataSets()
        this.loaded = true
      } catch (e) {
        this.error = `读取本地数据失败：${(e && e.message) || e}`
        console.error('[businessDataStore] load', e)
      } finally {
        this.loading = false
      }
      return this.dataSets
    },

    /**
     * 导入并落库
     * @param {Object} payload
     * @param {string} payload.name 数据集名称
     * @param {import('../utils/dataParser.js').FieldConfig[]} payload.fields
     * @param {import('../utils/dataParser.js').BusinessRecord[]} payload.records
     * @param {string} payload.level 主层级
     * @returns {Promise<import('../utils/dataParser.js').BusinessDataSet|null>}
     */
    async create({ name, fields, records, level }) {
      this.error = ''
      const id = uuid()
      const meta = {
        id,
        name: name || '未命名数据集',
        createdAt: Date.now(),
        recordCount: records.length,
        fields,
        isActive: this.dataSets.length === 0, // 首个数据集默认激活
        level: level || 'auto'
      }
      try {
        // 先写记录再写元信息：中途失败时不会出现「有元信息无数据」的空壳
        await db.bulkPutRecords(id, records)
        await db.putDataSet(meta)
        this.dataSets = await db.listDataSets()
      } catch (e) {
        // 元信息写入失败时回滚已写入的记录，避免留下孤儿数据
        await db.clearRecords(id).catch(() => {})
        this.error = `导入失败：${(e && e.message) || e}`
        console.error('[businessDataStore] create', e)
        return null
      }
      return meta
    },

    /**
     * 切换激活状态
     * @param {string} id
     * @param {boolean} active
     * @param {{exclusive?: boolean}} [opts] exclusive 为真时先停用其它数据集（默认单一激活）
     */
    async setActive(id, active, opts = {}) {
      const exclusive = opts.exclusive !== false
      this.error = ''
      try {
        if (active && exclusive) {
          const others = this.dataSets.filter((d) => d.id !== id && d.isActive)
          for (const d of others) {
            await db.patchDataSet(d.id, { isActive: false })
            d.isActive = false
          }
        }
        await db.patchDataSet(id, { isActive: active })
        const target = this.dataSets.find((d) => d.id === id)
        if (target) target.isActive = active
      } catch (e) {
        this.error = `切换激活失败：${(e && e.message) || e}`
        console.error('[businessDataStore] setActive', e)
      }
    },

    /** 重命名 */
    async rename(id, name) {
      const next = String(name || '').trim()
      if (!next) {
        this.error = '名称不能为空'
        return
      }
      try {
        await db.patchDataSet(id, { name: next })
        const target = this.dataSets.find((d) => d.id === id)
        if (target) target.name = next
      } catch (e) {
        this.error = `重命名失败：${(e && e.message) || e}`
      }
    },

    /** 删除数据集（级联清理记录） */
    async remove(id) {
      this.error = ''
      try {
        await db.deleteDataSet(id)
        this.dataSets = this.dataSets.filter((d) => d.id !== id)
      } catch (e) {
        this.error = `删除失败：${(e && e.message) || e}`
        console.error('[businessDataStore] remove', e)
      }
    },

    /**
     * 查询某数据集下某区域的记录
     * @param {string} dataSetId
     * @param {string} adcode
     * @returns {Promise<import('../utils/dataParser.js').BusinessRecord[]>}
     */
    async recordsOf(dataSetId, adcode) {
      try {
        return await db.getRecords(dataSetId, adcode)
      } catch (e) {
        console.error('[businessDataStore] recordsOf', e)
        return []
      }
    },

    /** 清空全部业务数据 */
    async clearAll() {
      try {
        await db.clearAll()
        this.dataSets = []
      } catch (e) {
        this.error = `清空失败：${(e && e.message) || e}`
      }
    }
  }
})
