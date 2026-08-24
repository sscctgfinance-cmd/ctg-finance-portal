// Ctrl/Cmd+S — app.html:1299-1311.
//
// The layout registers one keydown handler and each screen can register what Save means on it.
// Company Info in edit mode → infoSave(); Quick Invoice → qiPreview(); everything else → browser default.
// No golden sees a keystroke, so the wiring is pinned by SOURCE.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isSaveKey, registerScreenSave, screenSave } from '../src/finance-save';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const LAYOUT = strip(readFileSync(join(__dirname, '../app/finance/layout.tsx'), 'utf8'));
const INFO = strip(readFileSync(join(__dirname, '../app/finance/info/page.tsx'), 'utf8'));
const QINV = strip(readFileSync(join(__dirname, '../app/finance/qinv/page.tsx'), 'utf8'));

describe('the Finance layout has ONE Ctrl/Cmd+S listener', () => {
  it('imports isSaveKey and screenSave', () => {
    expect(LAYOUT).toMatch(/isSaveKey/);
    expect(LAYOUT).toMatch(/screenSave/);
  });

  it('calls screenSave() inside a keydown handler', () => {
    expect(LAYOUT).toMatch(/addEventListener.*keydown/);
    expect(LAYOUT).toMatch(/screenSave\(\)/);
  });

  it('calls e.preventDefault() when a saver is registered', () => {
    expect(LAYOUT).toMatch(/preventDefault/);
  });
});

describe('Company Info registers its save in edit mode only', () => {
  it('imports registerScreenSave', () => {
    expect(INFO).toMatch(/registerScreenSave/);
  });

  it('registers only in edit mode', () => {
    expect(INFO).toMatch(/mode\s*!==\s*'edit'/);
    expect(INFO).toMatch(/registerScreenSave/);
  });
});

describe('Quick Invoice always registers its preview', () => {
  it('imports registerScreenSave', () => {
    expect(QINV).toMatch(/registerScreenSave/);
  });

  it('registers onPreview', () => {
    expect(QINV).toMatch(/registerScreenSave\(onPreview\)/);
  });
});

describe('isSaveKey', () => {
  it('matches Ctrl+S', () => {
    expect(isSaveKey({ ctrlKey: true, key: 's' })).toBe(true);
  });

  it('matches Cmd+S', () => {
    expect(isSaveKey({ metaKey: true, key: 's' })).toBe(true);
  });

  it('does not match plain S', () => {
    expect(isSaveKey({ key: 's' })).toBe(false);
  });

  it('does not match Ctrl+D', () => {
    expect(isSaveKey({ ctrlKey: true, key: 'd' })).toBe(false);
  });
});

describe('registerScreenSave / screenSave', () => {
  it('returns null when nothing is registered', () => {
    expect(screenSave()).toBeNull();
  });

  it('registers and returns the function', () => {
    let hit = 0;
    const off = registerScreenSave(() => { hit++; });
    expect(screenSave()).not.toBeNull();
    screenSave()!();
    expect(hit).toBe(1);
    off();
    expect(screenSave()).toBeNull();
  });

  it('a second registration replaces the first', () => {
    registerScreenSave(() => {});
    let hit = 0;
    const off = registerScreenSave(() => { hit += 10; });
    screenSave()!();
    expect(hit).toBe(10);
    off();
  });
});
