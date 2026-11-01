/** The ticket ledger: a search index of every ticket's words, so the main Session finds earlier work it no longer holds in context. */
import { latestReport, type Ticket } from '../core/index.ts'
import { searchTerms } from '../infra/text.ts'
import { pullsOf } from '../sources/github-pull.ts'
import type { Store } from './store.ts'

/** What a worker says its ticket was about, for later searches: a short summary, and keywords in English and the source language. */
export interface Memo { summary: string; keywords: string[] }
/** One ticket's ledger record: its worker's memo, the words it is found by, and when it was last active. */
interface Entry { memo?: Memo; terms: string[]; at: string }
/** A ticket a search found: when it was last active, and the words of the query it holds. */
export interface Recalled { ticketId: string; at: string; matched: string[] }
/** What a search asks for: active since or until a day (`YYYY-MM-DD`, UTC), open or ended, at least `least` of its words. */
export interface RecallQuery { since?: string; until?: string; state?: 'open' | 'ended'; exclude?: readonly string[]; least?: number; offset?: number; limit: number }
export interface LedgerHost { readonly store: Pick<Store, 'db' | 'tickets' | 'triggers' | 'atomic'> }
/** How much of each text a ticket is found by, and how many words of a query a search uses. */
const TEXT_CHARS = 2000, QUERY_TERMS = 24
const DAY_MS = 86_400_000

/**
 * Keeps one search entry per ticket, in the transaction of the change it follows: a ticket's creation and end, and a result
 * or a memo its worker reports. It reads tickets and Triggers, and writes only its own tables, `ledger` and its full-text
 * index `ledger_fts`, which Store creates. Text is split into words as `searchTerms` does, so Chinese, which has no spaces,
 * matches by words too.
 */
export class Ledger {
  constructor(private readonly host: LedgerHost) {}
  /** Index a ticket afresh from its stored state, with its worker's memo: `memo`, else the one it reported before. */
  index(ticketId: string, memo?: Memo): void {
    const ticket = this.host.store.tickets.get(ticketId)
    if (!ticket) return
    const kept = memo ?? this.entry(ticketId)?.memo
    const terms = searchTerms(this.text(ticket, kept)), at = ticket.ended?.at ?? ticket.updatedAt
    const { db } = this.host.store
    db.prepare('INSERT INTO ledger (id, value, at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, at = excluded.at')
      .run(ticketId, JSON.stringify({ ...kept ? { memo: kept } : {}, terms, at } satisfies Entry), at)
    db.prepare('DELETE FROM ledger_fts WHERE id = ?').run(ticketId)
    db.prepare('INSERT INTO ledger_fts (id, terms) VALUES (?, ?)').run(ticketId, terms.join(' '))
  }
  /** Index every ticket the ledger has no entry for, such as those an earlier version recorded, in one transaction; returns how many. */
  backfill(): number {
    return this.host.store.atomic(() => {
      const ids = this.host.store.db.prepare('SELECT id FROM ticket WHERE id NOT IN (SELECT id FROM ledger)').all().map(row => String(row.id))
      for (const id of ids) this.index(id)
      return ids.length
    })
  }
  /**
   * The tickets whose words best match `query`, by BM25, the more recently active first among equals, keeping those that hold
   * at least `least` of its words (1 by default) and are none of `exclude`.
   */
  search(query: string, options: RecallQuery): Recalled[] {
    const words = searchTerms(query).slice(0, QUERY_TERMS)
    if (!words.length) return []
    // Each word is quoted, so the query's own text cannot use FTS5 operators.
    const match = words.map(word => `"${word.replaceAll('"', '""')}"`).join(' OR ')
    const until = options.until && new Date(Date.parse(`${options.until}T00:00:00Z`) + DAY_MS).toISOString()
    const where = ['ledger_fts MATCH ?', ...options.since ? ['l.at >= ?'] : [], ...until ? ['l.at < ?'] : [],
      ...options.state ? [`json_extract(t.value, '$.ended') IS ${options.state === 'open' ? '' : 'NOT '}NULL`] : []]
    const offset = options.offset ?? 0, least = Math.min(options.least ?? 1, words.length), exclude = new Set(options.exclude)
    const rows = this.host.store.db.prepare(`SELECT f.id AS id, l.value AS value, l.at AS at FROM ledger_fts f JOIN ledger l ON l.id = f.id
      JOIN ticket t ON t.id = f.id WHERE ${where.join(' AND ')} ORDER BY bm25(ledger_fts), l.at DESC LIMIT ?`)
      .all(match, ...options.since ? [options.since] : [], ...until ? [until] : [], offset + options.limit + 50)
    return rows.flatMap(row => {
      const id = String(row.id), terms = new Set((JSON.parse(String(row.value)) as Entry).terms)
      const matched = words.filter(word => terms.has(word))
      return matched.length >= least && !exclude.has(id) ? [{ ticketId: id, at: String(row.at), matched }] : []
    }).slice(offset, offset + options.limit)
  }
  private entry(ticketId: string): Entry | undefined {
    const row = this.host.store.db.prepare('SELECT value FROM ledger WHERE id = ?').get(ticketId)
    return row ? JSON.parse(String(row.value)) as Entry : undefined
  }
  /** What a ticket is found by: its title and scope, the messages it was accepted from, its latest report, its memo, its PRs and its people. */
  private text(ticket: Ticket, memo?: Memo): string {
    const trigger = (id: string) => this.host.store.triggers.get(id)
    const origin = ticket.origin.triggerIds.flatMap(id => trigger(id)?.text.slice(0, TEXT_CHARS) ?? [])
    const people = new Set([ticket.mandate.actor.id, ...ticket.inputs.flatMap(input => input.kind === 'trigger' && input.human
      ? trigger(input.triggerId)?.actor.id ?? [] : [])])
    return [ticket.title, ticket.mandate.scope, ...origin, latestReport(ticket)?.summary.slice(0, TEXT_CHARS) ?? '', memo?.summary ?? '',
      ...memo?.keywords ?? [], ...pullsOf(ticket).map(number => `#${number}`), ...people].join('\n')
  }
}
