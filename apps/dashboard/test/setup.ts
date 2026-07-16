import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * Node 22+'s built-in `localStorage` global (Web Storage API, active without
 * a flag on some Node versions) shadows jsdom's own implementation and
 * throws "not a function" without a `--localstorage-file` path — so tests
 * get a working in-memory Storage instead of Node's broken stub.
 */
class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length() {
    return this.#data.size;
  }
  clear() {
    this.#data.clear();
  }
  getItem(key: string) {
    return this.#data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#data.set(key, value);
  }
  removeItem(key: string) {
    this.#data.delete(key);
  }
  key(index: number) {
    return [...this.#data.keys()][index] ?? null;
  }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });

afterEach(() => {
  cleanup();
});
