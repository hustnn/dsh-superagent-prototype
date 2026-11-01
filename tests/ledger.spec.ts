/** The ticket ledger: search terms, indexing, memos, recall filters and the backfill, on the SQLite Store. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Ticket, Trigger } from '../src/core/index.ts'
import { Ledger } from '../src/app/ledger.ts'
import { Store } from '../src/app/store.ts'
import { searchTerms } from '../src/infra/text.ts'

let directory: string
let store: Store
let ledger: Ledger
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orchestrator-ledger-'))
  store = new Store(join(directory, 'orchestrator.sqlite'))
  ledger = new Ledger({ store })
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

const trigger = (id: string, text: string): Trigger => ({ id, source: 'chat', threads: [{ source: 'chat', id }], actor: { source: 'chat', id: 'ou_alice' },
  human: true, at: '2026-10-01T00:00:00.000Z', text, meta: {} })
/** Store a ticket accepted from one message with `text`, active at `at`, ended there when `ended`. */
function ticket(id: string, title: string, text: string, at: string, ended = false): Ticket {
  store.triggers.save(trigger(`trigger-${id}`, text))
  const value: Ticket = { id, title, decisionId: `d-${id}`, channels: [], assignments: [], inputs: [], undelivered: [], createdAt: at, updatedAt: at,
    mandate: { strength: 'explicit', policyVersion: 'v', basis: { via: 'addressed', addressed: 'mention' }, actor: { source: 'chat', id: 'ou_alice' }, scope: title },
    origin: { triggerId: `trigger-${id}`, triggerIds: [`trigger-${id}`] }, ...ended ? { ended: { at, by: 'executor', outcome: 'completed' } } : {} }
  store.tickets.save(value)
  return value
}
const ids = (query: string, options: Parameters<Ledger['search']>[1] = { limit: 10 }) => ledger.search(query, options).map(hit => hit.ticketId)

it('splits text into the words it is found by: Chinese by words, without stop words and single characters other than digits', () => {
  expect(searchTerms('上个月那个暗色模式的问题')).toEqual(['暗色', '模式'])
  expect(searchTerms('Fix the Dark mode in PR #131, please; dark MODE again')).toEqual(['fix', 'dark', 'mode', 'pr', '131'])
  expect(searchTerms('#7 的 a')).toEqual(['7'])
  expect(searchTerms('@bot 帮忙看下 @_user_1 的导出')).toEqual(['导出'])
})

it('finds a ticket by the words of its title, its messages, its report and its memo, best match first', () => {
  ticket('t1', '设置页按钮文案', '设置页的“保存修改”按钮文案改成“保存”', '2026-10-01T00:00:00.000Z', true)
  ticket('t2', '表格行高', '暗色模式下表格行高太高，和其他卡片不一致', '2026-10-02T00:00:00.000Z', true)
  for (const id of ['t1', 't2']) ledger.index(id)
  // A function word such as 的 matches nothing, so only the ticket about dark mode is found.
  expect(ids('上个月那个暗色模式的问题')).toEqual(['t2'])
  expect(ledger.search('暗色 表格 按钮', { limit: 10 }).map(hit => [hit.ticketId, hit.matched])).toEqual([['t2', ['暗色', '表格']], ['t1', ['按钮']]])
  // English finds the Chinese ticket only through the keywords its worker's memo gives in both languages, which a later index keeps.
  expect(ids('dark mode')).toEqual([])
  ledger.index('t2', { summary: 'Fixed the row height of tables in dark mode.', keywords: ['dark mode', '暗色模式'] })
  ledger.index('t2')
  expect(ids('dark mode')).toEqual(['t2'])
  // A report's summary is found too, once the ticket is indexed again.
  store.tickets.save({ ...store.tickets.get('t1')!, assignments: [{ id: 'a', state: 'ended', createdAt: '', report: { state: 'ready', summary: 'Renamed the Save button', at: '' } }] })
  ledger.index('t1')
  expect(ids('save button')).toEqual(['t1'])
})

it('keeps the tickets a search asks for: by days active, open or ended, enough of its words, and none it excludes', () => {
  ticket('old', '导出按钮', '加一个导出按钮', '2026-09-15T08:00:00.000Z', true)
  ticket('new', '导出格式', '导出按钮支持 CSV 格式', '2026-10-20T08:00:00.000Z')
  for (const id of ['old', 'new']) ledger.index(id)
  expect(ids('导出 按钮')).toEqual(expect.arrayContaining(['old', 'new']))
  expect(ids('导出', { since: '2026-10-01', limit: 10 })).toEqual(['new'])
  expect(ids('导出', { until: '2026-09-15', limit: 10 })).toEqual(['old'])
  expect(ids('导出', { state: 'open', limit: 10 })).toEqual(['new'])
  expect(ids('导出', { state: 'ended', limit: 10 })).toEqual(['old'])
  expect(ids('导出 csv 格式', { least: 2, limit: 10 })).toEqual(['new'])
  expect(ids('导出', { exclude: ['new'], limit: 10 })).toEqual(['old'])
  expect(ids('导出', { offset: 1, limit: 10 })).toHaveLength(1)
  // A query's own FTS5 operators and quotes are words, not syntax, and a query of no words finds nothing.
  expect(ids('AND OR NOT "导出')).toEqual(expect.arrayContaining(['old', 'new']))
  expect(ids('的 了 a')).toEqual([])
})

it('indexes once the tickets an earlier version recorded, and a ticket again in place', () => {
  ticket('t1', 'Login page', 'The login page is slow', '2026-10-01T00:00:00.000Z')
  ticket('t2', 'Signup page', 'The signup page is slow', '2026-10-01T00:00:00.000Z')
  ledger.index('t1')
  expect(ledger.backfill()).toBe(1)
  expect(ledger.backfill()).toBe(0)
  ledger.index('t1')
  expect(store.db.prepare('SELECT COUNT(*) AS n FROM ledger_fts').get()).toEqual({ n: 2 })
  expect(ids('slow page')).toEqual(expect.arrayContaining(['t1', 't2']))
  ledger.index('unknown')
  expect(store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 2 })
})
