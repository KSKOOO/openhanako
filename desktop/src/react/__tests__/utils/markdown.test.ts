/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderMarkdownPreview } from '../../utils/markdown';

describe('renderMarkdown', () => {
  it('renders inline and block KaTeX math', () => {
    const html = renderMarkdown('inline $x+1$\n\n$$\ny^2\n$$');

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
  });

  it('renders LaTeX parenthesis and bracket math delimiters', () => {
    const html = renderMarkdown('inline \\(x+1\\)\n\n\\[\ny^2\n\\]');

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain('\\(x+1\\)');
    expect(html).not.toContain('\\[');
  });

  it('renders Obsidian ==highlight== syntax as mark', () => {
    const html = renderMarkdown('GDP ==平减指数==');

    expect(html).toContain('<mark>平减指数</mark>');
  });

  it('renders whitelisted Obsidian background span as a safe mark', () => {
    const html = renderMarkdown('<span style="background:#fff88f">GDP平减指数</span>');

    expect(html).toContain('<mark style="background-color:#fff88f">GDP平减指数</mark>');
  });

  it('keeps non-whitelisted span markup escaped', () => {
    const html = renderMarkdown('<span onclick="alert(1)">bad</span>');

    expect(html).toContain('&lt;span onclick=');
    expect(html).toContain('bad&lt;/span&gt;');
    expect(html).not.toContain('<span onclick=');
  });

  it('keeps default markdown rendering from rendering raw HTML', () => {
    const html = renderMarkdown('<div style="color:red">card</div>');

    expect(html).toContain('&lt;div');
    expect(html).not.toContain('<div style=');
  });

  it('renders filtered HTML in markdown preview mode', () => {
    const html = renderMarkdownPreview([
      '<div style="background: #f0f7ff; border: 1px solid #bee1e6; border-radius: 8px; padding: 16px; margin: 12px 0;">',
      '<center>总结</center>',
      '',
      '### 会计基础 知识框架',
      '',
      '会计基础',
      '└─ 借贷记账法',
      '</div>',
    ].join('\n'));

    expect(html).toContain('<div style="background: #f0f7ff; border: 1px solid #bee1e6; border-radius: 8px; padding: 16px; margin: 12px 0">');
    expect(html).toContain('<center>总结</center>');
    expect(html).toContain('<h3>会计基础 知识框架</h3>');
    expect(html).toContain('└─ 借贷记账法');
  });

  it('removes dangerous HTML from markdown preview output', () => {
    const html = renderMarkdownPreview([
      '<script>alert(1)</script>',
      '<div onclick="alert(1)" onload="alert(2)">safe text</div>',
      '<img src=x onerror="alert(3)">',
    ].join('\n'));

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onload');
    expect(html).not.toContain('<img');
    expect(html).toContain('<div>safe text</div>');
  });

  it('filters unsafe markdown preview links while preserving safe links', () => {
    const html = renderMarkdownPreview([
      '<a href="javascript:alert(1)">bad</a>',
      '<a href="https://example.com/path">good</a>',
    ].join('\n'));

    expect(html).toContain('<a>bad</a>');
    expect(html).toContain('<a href="https://example.com/path" rel="noopener noreferrer">good</a>');
    expect(html).not.toContain('javascript:');
  });

  it('filters unsafe preview styles while preserving safe presentation styles', () => {
    const html = renderMarkdownPreview('<div style="background: url(javascript:alert(1)); color: #333; position: fixed; padding: 8px; display: flex;">x</div>');

    expect(html).toContain('<div style="color: #333; padding: 8px; display: flex">x</div>');
    expect(html).not.toContain('url(');
    expect(html).not.toContain('position');
    expect(html).not.toContain('fixed');
  });
});
