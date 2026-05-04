/**
 * Markdown 渲染器
 *
 * 通过 npm import 使用 markdown-it，不依赖全局 window.markdownit。
 */

import markdownit from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import mk from '@traptitech/markdown-it-katex';
import taskLists from 'markdown-it-task-lists';
import 'katex/dist/katex.min.css';
import { sanitizeMarkdownPreviewHtml } from './markdown-html-sanitizer';

type MarkdownItInstance = ReturnType<typeof markdownit>;

let _md: MarkdownItInstance | null = null;
let _previewMd: MarkdownItInstance | null = null;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?$/;
const RGB_COLOR_RE = /^rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i;
const BG_SPAN_RE = /^<span\s+style=(["'])\s*background(?:-color)?\s*:\s*([^;"']+)\s*;?\s*\1>([\s\S]*?)<\/span>/i;
const INLINE_MATH_OPEN = '\\(';
const INLINE_MATH_CLOSE = '\\)';
const BLOCK_MATH_OPEN = '\\[';
const BLOCK_MATH_CLOSE = '\\]';

function normalizeSafeBackgroundColor(raw: string): string | null {
  const color = raw.trim();
  if (HEX_COLOR_RE.test(color)) return color;
  if (RGB_COLOR_RE.test(color)) return color;
  return null;
}

function tokenizeInner(state: StateInline, from: number, to: number): void {
  const oldPos = state.pos;
  const oldMax = state.posMax;
  state.pos = from;
  state.posMax = to;
  state.md.inline.tokenize(state);
  state.pos = oldPos;
  state.posMax = oldMax;
}

function obsidianHighlights(md: MarkdownItInstance): void {
  md.inline.ruler.before('emphasis', 'obsidian_mark', (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== '==') return false;
    const end = state.src.indexOf('==', start + 2);
    if (end < 0 || end === start + 2) return false;

    if (!silent) {
      state.push('mark_open', 'mark', 1);
      tokenizeInner(state, start + 2, end);
      state.push('mark_close', 'mark', -1);
    }
    state.pos = end + 2;
    return true;
  });

  md.inline.ruler.before('text', 'obsidian_background_span', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x3C) return false; // <
    const match = BG_SPAN_RE.exec(state.src.slice(start));
    if (!match) return false;
    const color = normalizeSafeBackgroundColor(match[2]);
    if (!color) return false;

    if (!silent) {
      const open = state.push('mark_open', 'mark', 1);
      open.attrSet('style', `background-color:${color}`);
      const innerStart = start + match[0].indexOf('>') + 1;
      const innerEnd = start + match[0].length - '</span>'.length;
      tokenizeInner(state, innerStart, innerEnd);
      state.push('mark_close', 'mark', -1);
    }
    state.pos = start + match[0].length;
    return true;
  });
}

function isEscaped(src: string, pos: number): boolean {
  let count = 0;
  for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === 0x5C; i -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function findUnescapedDelimiter(src: string, delimiter: string, from: number, to: number): number {
  let pos = src.indexOf(delimiter, from);
  while (pos >= 0 && pos < to) {
    if (!isEscaped(src, pos)) return pos;
    pos = src.indexOf(delimiter, pos + delimiter.length);
  }
  return -1;
}

function findLineEndingDelimiter(line: string, delimiter: string): number {
  let from = 0;
  while (from < line.length) {
    const pos = findUnescapedDelimiter(line, delimiter, from, line.length);
    if (pos < 0) return -1;
    if (line.slice(pos + delimiter.length).trim() === '') return pos;
    from = pos + delimiter.length;
  }
  return -1;
}

function texBracketMath(md: MarkdownItInstance): void {
  md.inline.ruler.before('escape', 'tex_parenthesis_math', (state: StateInline, silent: boolean) => {
    const start = state.pos;
    if (state.src.slice(start, start + INLINE_MATH_OPEN.length) !== INLINE_MATH_OPEN) return false;

    const contentStart = start + INLINE_MATH_OPEN.length;
    const close = findUnescapedDelimiter(state.src, INLINE_MATH_CLOSE, contentStart, state.posMax);
    if (close < 0 || close === contentStart) return false;

    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.markup = INLINE_MATH_OPEN;
      token.content = state.src.slice(contentStart, close);
    }
    state.pos = close + INLINE_MATH_CLOSE.length;
    return true;
  });

  md.block.ruler.before('paragraph', 'tex_bracket_math_block', (
    state: StateBlock,
    startLine: number,
    endLine: number,
    silent: boolean,
  ) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (start + BLOCK_MATH_OPEN.length > max) return false;
    if (state.src.slice(start, start + BLOCK_MATH_OPEN.length) !== BLOCK_MATH_OPEN) return false;

    let nextLine = startLine;
    const firstLine = state.src.slice(start + BLOCK_MATH_OPEN.length, max);
    const firstLineClose = findLineEndingDelimiter(firstLine, BLOCK_MATH_CLOSE);
    let content = '';

    if (firstLineClose >= 0) {
      content = firstLine.slice(0, firstLineClose);
    } else {
      let found = false;
      let lastLine = '';
      for (nextLine = startLine + 1; nextLine < endLine; nextLine += 1) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineMax = state.eMarks[nextLine];
        if (lineStart < lineMax && state.tShift[nextLine] < state.blkIndent) break;

        const line = state.src.slice(lineStart, lineMax);
        const close = findLineEndingDelimiter(line, BLOCK_MATH_CLOSE);
        if (close >= 0) {
          lastLine = line.slice(0, close);
          found = true;
          break;
        }
      }

      if (!found) return false;
      content = (firstLine.trim() ? `${firstLine}\n` : '')
        + state.getLines(startLine + 1, nextLine, state.tShift[startLine], true)
        + (lastLine.trim() ? lastLine : '');
    }

    if (!content.trim()) return false;
    if (silent) return true;

    state.line = nextLine + 1;
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = content;
    token.map = [startLine, state.line];
    token.markup = `${BLOCK_MATH_OPEN}${BLOCK_MATH_CLOSE}`;
    return true;
  }, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}

function applyMarkdownPlugins(md: MarkdownItInstance): void {
  md.use(mk);
  md.use(texBracketMath);
  md.use(taskLists, { enabled: false, label: true });
  md.use(obsidianHighlights);
}

/** 获取默认 md 实例（html: false, katex 插件） */
export function getMd(): MarkdownItInstance {
  if (_md) return _md;
  _md = markdownit({
    html: false,
    breaks: true,
    linkify: true,
    typographer: true,
  });
  applyMarkdownPlugins(_md);
  return _md;
}

/** 获取文件预览专用 md 实例（html: true，渲染后必须 sanitizer） */
export function getPreviewMd(): MarkdownItInstance {
  if (_previewMd) return _previewMd;
  _previewMd = markdownit({
    html: true,
    breaks: true,
    linkify: true,
    typographer: true,
  });
  applyMarkdownPlugins(_previewMd);
  return _previewMd;
}

const _cache = new Map<string, MarkdownItInstance>();

/** 获取自定义选项的 md 实例（缓存复用） */
export function getMdWithOpts(opts: Parameters<typeof markdownit>[0]): MarkdownItInstance {
  const key = JSON.stringify(opts);
  let inst = _cache.get(key);
  if (!inst) {
    inst = markdownit(opts);
    _cache.set(key, inst);
  }
  return inst;
}

export function renderMarkdown(src: string): string {
  return getMd().render(src);
}

export function renderMarkdownPreview(src: string): string {
  try {
    return sanitizeMarkdownPreviewHtml(getPreviewMd().render(src));
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[markdown] preview sanitizer failed:', err);
    }
    return renderMarkdown(src);
  }
}
