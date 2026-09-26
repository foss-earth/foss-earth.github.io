import { beforeEach, vi } from "vitest";
import { resetAppSettings } from "../settings/appSettings";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  },
});

beforeEach(() => {
  storage.clear();
  // The app registry reads storage once; each test starts from an empty record.
  resetAppSettings();
});