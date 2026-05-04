import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

function read(relPath: string) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('rc attached UI ownership', () => {
  it('输入框上方不再渲染 RcAttachedBanner', () => {
    const inputAreaSource = read('components/InputArea.tsx');
    expect(inputAreaSource).not.toMatch(/RcAttachedBanner/);
  });

  it('session list 直接消费 session 自身的 rcAttachment 状态', () => {
    const sessionListSource = read('components/SessionList.tsx');
    expect(sessionListSource).toMatch(/s\.rcAttachment/);
    expect(sessionListSource).toMatch(/接管中/);
  });
});
