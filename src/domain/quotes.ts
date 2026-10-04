import { sourceWhitespaceMap } from "./retrieval-index";

export interface TextInterval { start: number; end: number }
export interface OriginalQuote { quoted_span: string; start_offset: number; end_offset: number }
export function intervalsCover(start: number, end: number, intervals: readonly TextInterval[]): boolean {
  let cursor = start;
  for (const interval of [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (interval.end <= cursor) continue;
    if (interval.start > cursor) return false;
    cursor = Math.max(cursor, interval.end);
    if (cursor >= end) return true;
  }
  return cursor >= end;
}

/** Restores whitespace only; never expands omissions or changes words/punctuation. */
export function restoreOriginalQuote(sourceText: string, requestedQuote: string, intervals: readonly TextInterval[] = [{ start: 0, end: sourceText.length }]): OriginalQuote | null {
  if (!requestedQuote.trim()) return null;
  const ranges = intervals.filter(interval => Number.isInteger(interval.start) && Number.isInteger(interval.end) && interval.start >= 0 && interval.end <= sourceText.length && interval.end > interval.start);
  for (let offset = sourceText.indexOf(requestedQuote); offset >= 0; offset = sourceText.indexOf(requestedQuote, offset + 1)) {
    const end = offset + requestedQuote.length;
    if (intervalsCover(offset, end, ranges)) return { quoted_span: sourceText.slice(offset, end), start_offset: offset, end_offset: end };
  }
  const normalizedQuote = requestedQuote.replace(/\s+/g, " ").trim();
  const normalizedSource = sourceWhitespaceMap(sourceText);
  for (let offset = normalizedSource.text.indexOf(normalizedQuote); offset >= 0; offset = normalizedSource.text.indexOf(normalizedQuote, offset + 1)) {
    const start = normalizedSource.starts[offset], end = normalizedSource.ends[offset + normalizedQuote.length - 1];
    if (intervalsCover(start, end, ranges)) return { quoted_span: sourceText.slice(start, end), start_offset: start, end_offset: end };
  }
  return null;
}
