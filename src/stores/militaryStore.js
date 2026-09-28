/**
 * 军事要素（布防 / 驻军 / 行军路线…）状态管理
 *
 * 与业务数据最大的不同：军事态势随时代变化，同一地点在不同年代可以各有一套布防。
 * 因此这里按「数据集」存放多份态势，每份可单独显隐，并支持按「时期 / 类型」过滤——
 * 想看哪个年代、哪一类要素，就切到那一层，而不是只有一份覆盖式的最终状态。
 *
 * 写操作同样先落 IndexedDB 再同步内存，刷新页面后状态一致。
 */
import { defineStore } from 'pinia'
import * as db from '../utils/indexedDB.js'
import { uuid } from '../utils/dataParser.js'
import { summarizeMil } from '../utils/militarySchema.js'

export const useMilitaryStore = defineStore('military', {
  state: () => ({
    /** 数据集元信息列表（含显隐、标注开关） */
    sets: [],
    /** setId → 要素数组；按需读取，避免每次过滤都打库 */
    cache: {},
    /** 当前生效的时期过滤：'' = 不限 */
    eraFilter: '',
    /** 当前生效的类型过滤：空数组 = 不限 */
    kindFilter: [],
    loaded: false,
    loading: false,
    error: ''
  }),

  getters: {
    /** 勾选显示的数据集 */
    visibleSets: (s) => s.sets.filter((d) => d.visible !== false),
    /** 全部时期（用于过滤下拉，去重排序） */
    eras: (s) => {
      const out = new Set()
      for (const d of s.sets) for (const e of d.eras || []) if (e) out.add(e)
      return [...out].sort()
    },
    /** 各类型的要素总数（用于类型过滤项的计数） */
    kindStats: (s) => {
      const out = {}
      for (const d of s.sets) {
        if (d.visible === false) continue
        for (const [k, n] of Object.entries(d.kindStats || {})) out[k] = (out[k] || 0) + n
      }
      return out
    },
    /**
     * 交给地图渲染的要素：可见数据集 → 应用时期 / 类型过滤。
     * 计算结果直接喂给 ThreeMap.setMilitary。
     */
    renderFeatures: (s) => {
      const era = s.eraFilter
      const kinds = s.kindFilter && s.kindFilter.length ? new Set(s.kindFilter) : null
      const out = []
      for (const d of s.sets) {
        if (d.visible === false) continue
        const list = s.cache[d.id] || []
        for (const f of list) {
          if (era && (f.era || '') !== era) continue
          if (kinds && !kinds.has(f.kind)) continue
          out.push(f)
        }
      }
      return out
    },
    totalCount: (s) => s.sets.reduce((n, d) => n + (d.featureCount || 0), 0)
  },

  actions: {
    /** 从 IndexedDB 装载数据集元信息（要素本身按需读） */
    async load(force = false) {
      if (this.loaded && !force) return this.sets
      this.loading = true
      this.error = ''
      try {
        this.sets = await db.listMilSets()
        this.loaded = true
      } catch (e) {
        this.error = `读取本地军事要素失败：${(e && e.message) || e}`
        console.error('[militaryStore] load', e)
      } finally {
        this.loading = false
      }
      return this.sets
    },

    /**
     * 导入落库
     * @param {{name: string, features: Object[]}} payload
     * @returns {Promise<Object|null>} 数据集元信息
     */
    async create({ name, features }) {
      this.error = ''
      const id = uuid()
      const stat = summarizeMil(features)
      const meta = {
        id,
        name: name || '未命名军事要素集',
        createdAt: Date.now(),
        featureCount: features.length,
        kindStats: stat.byKind,
        eras: stat.eras,
        sides: stat.sides,
        visible: true,   // 新导入默认显示，否则用户会以为没导进来
        labelOn: true
      }
      // 面板交过来的是 Vue 响应式代理（Proxy），IndexedDB 的结构化克隆不接受 Proxy，
      // 直接 put 会整批 DataCloneError 失败；入库前统一脱成纯对象。
      const payload = features.map((f) =>
        JSON.parse(JSON.stringify({ ...f, setId: id, setName: meta.name, id: `${id}:${f.id}` }))
      )
      try {
        await db.bulkPutMilFeatures(payload)
        await db.putMilSet(meta)
        this.cache[id] = payload
        this.sets = await db.listMilSets()
      } catch (e) {
        await db.clearMilFeatures(id).catch(() => {})
        this.error = `导入失败：${(e && e.message) || e}`
        console.error('[militaryStore] create', e)
        return null
      }
      return meta
    },

    /** 取某数据集的要素（带缓存） */
    async featuresOf(id) {
      if (this.cache[id]) return this.cache[id]
      try {
        const list = await db.listMilFeatures(id)
        this.cache[id] = list
        return list
      } catch (e) {
        console.error('[militaryStore] featuresOf', e)
        return []
      }
    },

    /** 装载全部可见数据集的要素，保证 renderFeatures 有数据 */
    async ensureFeatures() {
      for (const d of this.sets) {
        if (d.visible === false) continue
        if (!this.cache[d.id]) await this.featuresOf(d.id)
      }
    },

    async setVisible(id, visible) {
      const v = !!visible
      try {
        await db.patchMilSet(id, { visible: v })
        const t = this.sets.find((d) => d.id === id)
        if (t) t.visible = v
        if (v && !this.cache[id]) await this.featuresOf(id)
      } catch (e) {
        this.error = `切换显示失败：${(e && e.message) || e}`
      }
    },

    async setLabelOn(id, on) {
      const v = !!on
      try {
        await db.patchMilSet(id, { labelOn: v })
        const t = this.sets.find((d) => d.id === id)
        if (t) t.labelOn = v
      } catch (e) {
        this.error = `切换标注失败：${(e && e.message) || e}`
      }
    },

    async rename(id, name) {
      const next = String(name || '').trim()
      if (!next) return
      try {
        await db.patchMilSet(id, { name: next })
        const t = this.sets.find((d) => d.id === id)
        if (t) t.name = next
      } catch (e) {
        this.error = `重命名失败：${(e && e.message) || e}`
      }
    },

    async remove(id) {
      this.error = ''
      try {
        await db.deleteMilSet(id)
        this.sets = this.sets.filter((d) => d.id !== id)
        delete this.cache[id]
      } catch (e) {
        this.error = `删除失败：${(e && e.message) || e}`
        console.error('[militaryStore] remove', e)
      }
    },

    setEraFilter(v) {
      this.eraFilter = v || ''
    },

    setKindFilter(list) {
      this.kindFilter = Array.isArray(list) ? [...list] : []
    },

    toggleKind(key) {
      const has = this.kindFilter.includes(key)
      this.kindFilter = has ? this.kindFilter.filter((k) => k !== key) : [...this.kindFilter, key]
    }
  }
})
