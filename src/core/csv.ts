import { ReplenishError } from './errors.js'

/** Parsed CSV plus the 1-based physical line where each record starts. */
export interface ParsedCsv {
  rows: string[][]
  lines: number[]
}

const CSV_NEEDS_QUOTES = /[",\r\n]/

/** RFC 4180 field escaping: quote on comma, quote, CR or LF and double embedded quotes. */
export function csvField(value: string): string {
  return CSV_NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Build a UTF-8 CSV body with a trailing newline; empty input yields an empty string. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return ''
  return `${rows.map((row) => row.map(csvField).join(',')).join('\n')}\n`
}

/**
 * Parse RFC 4180 CSV: quoted fields, doubled quotes, embedded CR/LF and CRLF
 * records. Blank lines are ignored. Every malformed quote or NUL byte becomes
 * `E_REPL_CSV_ROW` with the physical line number.
 */
export function parseCsv(text: string): ParsedCsv {
  if (typeof text !== 'string') throw new ReplenishError('E_REPL_CSV_ROW', 'CSV 内容不是文本')
  if (text.includes('\0')) throw new ReplenishError('E_REPL_CSV_ROW', 'CSV 含 NUL 字节，不是文本文件')
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  const lines: number[] = []
  let row: string[] = []
  let field = ''
  let line = 1
  let recordLine = 1
  let inQuotes = false
  let quoteClosed = false

  const fail = (message: string): never => {
    throw new ReplenishError('E_REPL_CSV_ROW', `第 ${recordLine} 行：${message}`)
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
          quoteClosed = true
        }
      } else {
        if (char === '\n') line += 1
        field += char
      }
      continue
    }

    if (quoteClosed && char !== ',' && char !== '\n' && char !== '\r') {
      fail('双引号结束后还有多余字符（引号内的双引号要写成两个双引号）')
    }
    if (char === '"') {
      if (field.trim() === '') {
        field = ''
        inQuotes = true
        quoteClosed = false
      } else {
        fail('字段中间出现了未转义的双引号')
      }
    } else if (char === ',') {
      row.push(field)
      field = ''
      quoteClosed = false
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      field = ''
      quoteClosed = false
      if (!(row.length === 1 && row[0] === '')) {
        rows.push(row)
        lines.push(recordLine)
      }
      row = []
      line += 1
      recordLine = line
    } else {
      field += char
    }
  }

  if (inQuotes) fail('双引号没有闭合')
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row)
      lines.push(recordLine)
    }
  }
  return { rows, lines }
}
