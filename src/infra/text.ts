/** Word counting and string formatting utilities for IM message limits and templates. */
const words = new Intl.Segmenter('zh', { granularity: 'word' })
export const IM_WORDS = 100
export const NOTE_WORDS = 30
/** Counts word-like segments across Chinese, English, and mixed text, ignoring punctuation. */
export function wordCount(text: string): number {
  let count = 0
  for (const segment of words.segment(text)) if (segment.isWordLike) count++
  return count
}
/** Validates that an outgoing IM Markdown message does not exceed `IM_WORDS` (link labels and URLs both count toward the limit). */
export function checkedImText(text: string): string {
  const count = wordCount(text)
  if (count > IM_WORDS) throw new Error(`IM message has ${count} words; maximum is ${IM_WORDS}. Rewrite as a short high-level update. Do not split it into multiple messages.`)
  return text
}
/** Words that say little about what a message is about: Chinese and English function words and fillers. */
const STOP_WORDS = new Set(['这个', '那个', '这些', '那些', '一个', '一下', '一点', '上次', '这次', '上个', '下个', '上周', '昨天', '今天', '之前', '以前', '刚才',
  '一样', '说的', '再看', '问题', '我们', '你们', '他们',
  '可以', '就是', '还是', '什么', '怎么', '为什么', '现在', '然后', '因为', '所以', '但是', '如果', '已经', '没有', '不是', '还有', '这里', '那里', '时候',
  '东西', '帮忙', '麻烦', '看看', '能不能', '是不是', '好的', '谢谢', '一起', '顺便', '另外', 'the', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is',
  'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'with', 'as', 'at', 'by', 'from', 'we', 'you', 'me', 'my', 'our',
  'your', 'please', 'can', 'could', 'would', 'should', 'do', 'does', 'did', 'not', 'no', 'yes', 'so', 'if', 'then', 'but', 'about', 'there', 'here',
  'what', 'which', 'when', 'last', 'again', 'also', 'just', 'some', 'any', 'thanks'])
/**
 * The distinct words a text can be found by, lowercased and in order: its word-like segments, as `wordCount` counts them,
 * without mentions such as @bot, which most messages to the agent share, stop words, and single characters other than digits,
 * such as 的 or a.
 */
export function searchTerms(text: string): string[] {
  const terms = new Set<string>()
  for (const { segment, isWordLike } of words.segment(text.toLowerCase().replace(/@\S+/g, ' '))) {
    if (isWordLike && !STOP_WORDS.has(segment) && (segment.length > 1 || /\d/.test(segment))) terms.add(segment)
  }
  return [...terms]
}
export const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
/** Case-insensitive comparison for GitHub logins and repository names. */
export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
