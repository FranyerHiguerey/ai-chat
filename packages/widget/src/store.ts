/**
 * Small JSON storage over sessionStorage. Every access is wrapped: storage can be
 * missing, blocked (privacy settings, sandboxed iframes) or full, and the widget
 * must keep working in memory when it is.
 */
export interface Store {
  /** The stored value, or undefined if missing, unreadable or not JSON. Callers validate its shape. */
  load(): unknown;
  save(value: unknown): void;
  clear(): void;
}

export function sessionStore(key: string): Store {
  const storage = (): Storage | undefined => {
    try {
      return globalThis.sessionStorage ?? undefined;
    } catch {
      return undefined;
    }
  };
  return {
    load() {
      try {
        const raw = storage()?.getItem(key);
        return raw ? (JSON.parse(raw) as unknown) : undefined;
      } catch {
        return undefined;
      }
    },
    save(value) {
      try {
        storage()?.setItem(key, JSON.stringify(value));
      } catch {
        // Full or blocked: keep going in memory.
      }
    },
    clear() {
      try {
        storage()?.removeItem(key);
      } catch {
        // Nothing to clear.
      }
    },
  };
}

/** A store that lives in memory only (tests). */
export function memoryStore(initial?: unknown): Store {
  let value = initial;
  return {
    load: () => value,
    save: (next) => {
      value = next;
    },
    clear: () => {
      value = undefined;
    },
  };
}
