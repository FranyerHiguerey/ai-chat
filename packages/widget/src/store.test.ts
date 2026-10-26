import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionStore } from './store.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('sessionStore', () => {
  it('saves, loads and clears JSON', () => {
    const store = sessionStore('k');
    store.save({ a: 1 });
    expect(store.load()).toEqual({ a: 1 });
    store.clear();
    expect(store.load()).toBeUndefined();
  });

  it('returns undefined for corrupt JSON', () => {
    sessionStorage.setItem('k', '{not json');
    expect(sessionStore('k').load()).toBeUndefined();
  });

  it('keeps working when storage throws (blocked or full)', () => {
    const fail = () => {
      throw new DOMException('Denied', 'SecurityError');
    };
    vi.stubGlobal('sessionStorage', { getItem: fail, setItem: fail, removeItem: fail });
    const store = sessionStore('k');
    expect(() => store.save({ a: 1 })).not.toThrow();
    expect(store.load()).toBeUndefined();
    expect(() => store.clear()).not.toThrow();
  });

  it('keeps working when sessionStorage itself is inaccessible', () => {
    vi.stubGlobal('sessionStorage', undefined);
    const store = sessionStore('k');
    expect(() => store.save(1)).not.toThrow();
    expect(store.load()).toBeUndefined();
    expect(() => store.clear()).not.toThrow();
  });
});
