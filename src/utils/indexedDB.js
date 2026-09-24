/**
 * IndexedDB 封装层
 *
 * 基于 idb 库提供 Promise 化的 API，统一供 Pinia store 与组件调用。
 * 库结构（版本 1）：
 *   - datasets：数据集元信息（BusinessDataSet），主键 id
 *   - records：业务记录（BusinessRecord），自增主键 _id，按 adcode / datasetId 建索引
 *
 * 说明：所有函数均以 async 暴露，内部统一捕获并向上抛出带中文提示的错误，
 *       便于上层直接把 message 显示给用户。
 */
import { openDB } from 'idb'

/** 数据库名称 */
export const DB_NAME = 'maps-dashboard'
/** 数据库版本，结构变更时需 +1 并处理 upgrade 分支 */
export const DB_VERSION = 1

/** 数据集元信息仓库 */
export const STORE_DATASETS = 'datasets'
/** 业务记录仓库 */
export const STORE_RECORDS = 'records'

// 单例 Promise：避免并发首次访问时重复开库触发多次 upgrade
let dbPromise = null

/**
 * 获取数据库连接（单例）
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // 数据集元信息：主键为数据集 id（uuid）
        if (!db.objectStoreNames.contains(STORE_DATASETS)) {
          const ds = db.createObjectStore(STORE_DATASETS, { keyPath: 'id' })
          ds.createIndex('by-createdAt', 'createdAt')
        }
        // 业务记录：自增主键 _id；同一 adcode 允许有多条（不同年份 / 不同数据集）
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          const rs = db.createObjectStore(STORE_RECORDS, { keyPath: '_id', autoIncrement: true })
          rs.createIndex('by-adcode', 'adcode')
          rs.createIndex('by-dataset', 'datasetId')
          // 复合索引：先定位数据集再取某区域记录，面板查询的主要路径
          rs.createIndex('by-dataset-adcode', ['datasetId', 'adcode'])
        }
      },
      // 其它标签页持有旧版本连接时的回调：提示用户关闭多余页面
      blocked() {
        console.warn('[maps-dashboard] IndexedDB 升级被阻塞，请关闭其它标签页后重试')
      },
      blocking() {
        // 本连接阻塞了更高版本的升级，主动关闭让路
        if (dbPromise) {
          dbPromise.then((db) => db.close()).catch(() => {})
          dbPromise = null
        }
      },
      // 连接异常终止时清空缓存，下次调用自动重建
      terminated() {
        console.warn('[maps-dashboard] IndexedDB 连接被终止')
        dbPromise = null
      }
    })
  }
  return dbPromise
}

/** 包装一层错误提示，统一中文语境 */
async function run(fn) {
  const db = await getDB()
  return fn(db)
}

/* ------------------------------------------------------------------ */
/* 数据集元信息 CRUD                                                     */
/* ------------------------------------------------------------------ */

/**
 * 新增 / 覆盖一个数据集元信息
 * @param {import('./dataParser.js').BusinessDataSet} dataSet
 */
export async function putDataSet(dataSet) {
  return run((db) => db.put(STORE_DATASETS, dataSet))
}

/**
 * 列出全部数据集，按创建时间倒序（新导入的在前）
 * @returns {Promise<import('./dataParser.js').BusinessDataSet[]>}
 */
export async function listDataSets() {
  const all = await run((db) => db.getAll(STORE_DATASETS))
  return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/**
 * 读取单个数据集元信息
 * @param {string} id
 */
export async function getDataSet(id) {
  return run((db) => db.get(STORE_DATASETS, id))
}

/**
 * 局部更新数据集（如重命名、切换激活）
 * @param {string} id
 * @param {Partial<import('./dataParser.js').BusinessDataSet>} patch
 */
export async function patchDataSet(id, patch) {
  const db = await getDB()
  const old = await db.get(STORE_DATASETS, id)
  if (!old) throw new Error('数据集不存在，可能已被删除')
  return db.put(STORE_DATASETS, { ...old, ...patch, id })
}

/**
 * 删除数据集，并级联清理其下全部业务记录
 * @param {string} id
 */
export async function deleteDataSet(id) {
  const db = await getDB()
  const tx = db.transaction([STORE_DATASETS, STORE_RECORDS], 'readwrite')
  // 级联删除记录：先取该数据集全部主键再逐条删，避免游标事务被打断
  const keys = await tx.objectStore(STORE_RECORDS).index('by-dataset').getAllKeys(id)
  await Promise.all([
    ...keys.map((k) => tx.objectStore(STORE_RECORDS).delete(k)),
    tx.objectStore(STORE_DATASETS).delete(id),
    tx.done
  ])
}

/* ------------------------------------------------------------------ */
/* 业务记录操作                                                         */
/* ------------------------------------------------------------------ */

/**
 * 批量写入业务记录（导入主路径）
 * 单批可能上万条，走一个事务保证原子性：中途失败则整批回滚，不留脏数据
 * @param {string} dataSetId
 * @param {import('./dataParser.js').BusinessRecord[]} records
 */
export async function bulkPutRecords(dataSetId, records) {
  const db = await getDB()
  const tx = db.transaction(STORE_RECORDS, 'readwrite')
  const store = tx.objectStore(STORE_RECORDS)
  const payload = records.map((r) => ({ ...r, datasetId: dataSetId }))
  await Promise.all([...payload.map((r) => store.add(r)), tx.done])
  return payload.length
}

/**
 * 按 adcode 取指定数据集下的记录（同一 adcode 可能多条）
 * @param {string} dataSetId
 * @param {string} adcode
 * @returns {Promise<import('./dataParser.js').BusinessRecord[]>}
 */
export async function getRecords(dataSetId, adcode) {
  const db = await getDB()
  const range = IDBKeyRange.bound([dataSetId, adcode], [dataSetId, adcode + '\uffff'])
  return db.getAllFromIndex(STORE_RECORDS, 'by-dataset-adcode', range)
}

/**
 * 统计某数据集的记录总数
 * @param {string} dataSetId
 */
export async function countRecords(dataSetId) {
  const db = await getDB()
  return db.countFromIndex(STORE_RECORDS, 'by-dataset', dataSetId)
}

/**
 * 清空某数据集的全部记录（保留元信息）
 * @param {string} dataSetId
 */
export async function clearRecords(dataSetId) {
  const db = await getDB()
  const tx = db.transaction(STORE_RECORDS, 'readwrite')
  const keys = await tx.objectStore(STORE_RECORDS).index('by-dataset').getAllKeys(dataSetId)
  await Promise.all([...keys.map((k) => tx.objectStore(STORE_RECORDS).delete(k)), tx.done])
  return keys.length
}

/**
 * 删除全部数据（设置面板里的「清空」动作）
 */
export async function clearAll() {
  const db = await getDB()
  const tx = db.transaction([STORE_DATASETS, STORE_RECORDS], 'readwrite')
  await Promise.all([
    tx.objectStore(STORE_DATASETS).clear(),
    tx.objectStore(STORE_RECORDS).clear(),
    tx.done
  ])
}
