import { describe, expect, it } from 'vitest';
import { privateBrowserChoices, privateBrowserOperations, type PrivateBrowser } from './privateBrowserCatalog';
import { PRIVATE_BROWSER_SOURCES } from './privateBrowserSources';

describe('Private browser opening uses the confirmed platform recipe', () => {
  it('does not substitute a desktop or different-browser recipe for an unknown environment', () => {
    expect(privateBrowserChoices()).toEqual([]);
    for (const [browser, os] of [['safari', 'android'], ['safari', 'windows'], ['edge', 'ubuntu'], ['chrome', 'unknown']]) expect(privateBrowserOperations(browser as PrivateBrowser, os)).toBeUndefined();
    expect(privateBrowserOperations('safari', 'ios')).toBeUndefined();
  });

  it('distinguishes the actual iPhone and iPad controls instead of sharing one iOS menu', () => {
    const current = privateBrowserOperations('safari', 'ios', 'more')!, older = privateBrowserOperations('safari', 'ios', 'tabs')!, ipad = privateBrowserOperations('safari', 'ios', 'ipad')!;
    expect(current[0].action.ja).toContain('「詳細」'); expect(older.map(s => s.key)).toEqual(['tabs', 'private', 'new']); expect(ipad[0].action.ja).toContain('長押し'); expect(current[0].action.ja).not.toContain('長押し'); expect(older[1].action.ja).toContain('スワイプ');
  });

  it('uses mobile groups and current Android window labels without inventing a desktop menu', () => {
    for (const browser of ['firefox', 'edge'] as const) for (const os of ['ios', 'android']) expect(privateBrowserOperations(browser, os)!.map(s => s.key)).toEqual(['tabs', 'private', 'new']);
    expect(privateBrowserOperations('chrome', 'android')![1].action.en).toContain('Open in a new Incognito window'); expect(privateBrowserOperations('chrome', 'ios')![1].action.en).toContain('New Incognito Tab');
    expect(privateBrowserOperations('edge', 'macos')![0].action.en).toContain('Command'); expect(privateBrowserOperations('edge', 'windows')![0].action.en).toContain('Settings and more');
  });

  it('keeps a dated primary source and both languages for every supported opening operation', () => {
    for (const os of ['ios', 'android', 'windows', 'macos', 'ubuntu']) for (const browser of privateBrowserChoices(os)) {
      for (const layout of browser === 'safari' && os === 'ios' ? ['more', 'tabs', 'ipad'] as const : [undefined]) {
        const operations = privateBrowserOperations(browser, os, layout)!; expect(operations.length).toBeGreaterThan(0); expect(new Set(operations.map(o => o.key)).size).toBe(operations.length);
        for (const operation of operations) {
          for (const field of [operation.title, operation.action, operation.expected, operation.button]) for (const language of ['ja', 'en'] as const) expect(field[language].trim().length).toBeGreaterThan(0);
          expect(operation.sources.length).toBeGreaterThan(0);
          for (const id of operation.sources) { const source = PRIVATE_BROWSER_SOURCES[id as keyof typeof PRIVATE_BROWSER_SOURCES]; expect(source.checked).toBe('2026-11-14'); expect(new URL(source.url).protocol).toBe('https:'); expect(new URL(source.url).hostname).toMatch(/^(support\.apple\.com|support\.google\.com|support\.mozilla\.org|support\.microsoft\.com)$/); }
        }
      }
    }
  });
});
