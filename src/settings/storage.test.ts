import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT } from "../core/settings";
import { createAdapter, localStorageAdapter, normalizeRawInput, parseStored, STORAGE_KEY, type KeyValueStore } from "./storage";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("storage adapter", () => {
  it("uses the agreed localStorage key", () => {
    expect(STORAGE_KEY).toBe("workenergy.settings.v1");
  });

  it("writes then reads back the same input", async () => {
    const store = memoryStore();
    const adapter = createAdapter(() => store);
    const saved = { ...DEFAULT_INPUT, salary: "23456.78", lunchEnabled: false, lunchStart: "", lunchEnd: "", overtimeMode: true };

    await adapter.save(saved);

    expect(store.data.has(STORAGE_KEY)).toBe(true);
    expect(JSON.parse(store.data.get(STORAGE_KEY) as string)).toMatchObject({ salary: "23456.78", overtimeMode: true });
    expect(await adapter.load()).toEqual(saved);
  });

  it("returns null when nothing has been stored yet", async () => {
    expect(await createAdapter(() => memoryStore()).load()).toBeNull();
  });

  it("fills missing fields from the defaults (legacy record)", async () => {
    const store = memoryStore();
    store.data.set(STORAGE_KEY, JSON.stringify({ salary: "15000" }));

    const loaded = await createAdapter(() => store).load();

    expect(loaded).toEqual({ ...DEFAULT_INPUT, salary: "15000" });
  });

  it("survives corrupt or non-object payloads", async () => {
    const store = memoryStore();
    const adapter = createAdapter(() => store);

    store.data.set(STORAGE_KEY, "{not json");
    expect(await adapter.load()).toBeNull();

    store.data.set(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(await adapter.load()).toBeNull();

    store.data.set(STORAGE_KEY, JSON.stringify({ salary: 10000, lunchEnabled: "yes" }));
    expect(await adapter.load()).toEqual(DEFAULT_INPUT);

    expect(parseStored("null")).toBeNull();
    expect(normalizeRawInput(null)).toBeNull();
  });

  it("refuses to save when the host offers no storage", async () => {
    const adapter = createAdapter(() => null);
    await expect(adapter.save(DEFAULT_INPUT)).rejects.toThrow("当前环境没有可用的 localStorage");
    expect(await adapter.load()).toBeNull();
  });

  it("degrades to null in the node test environment where localStorage does not exist", async () => {
    expect(typeof (globalThis as { localStorage?: unknown }).localStorage).toBe("undefined");
    expect(await localStorageAdapter.load()).toBeNull();
  });
});

describe("storage of the display tiers", () => {
  it("round-trips decimals and refreshHz through the store", async () => {
    const store = memoryStore();
    const adapter = createAdapter(() => store);
    const saved = { ...DEFAULT_INPUT, decimals: 6 as const, refreshHz: 60 as const };

    await adapter.save(saved);

    const raw = store.data.get(STORAGE_KEY) as string;
    expect(JSON.parse(raw)).toMatchObject({ decimals: 6, refreshHz: 60 });
    expect(await adapter.load()).toEqual(saved);
  });

  it("falls back to 12 digits at 1Hz for a legacy record without the new fields", async () => {
    const store = memoryStore();
    store.data.set(STORAGE_KEY, JSON.stringify({ salary: "15000" }));

    const loaded = await createAdapter(() => store).load();

    expect(loaded?.decimals).toBe(12);
    expect(loaded?.refreshHz).toBe(1);
  });

  it("rejects stored tiers that the panel never offers", async () => {
    const adapter = createAdapter(() => memoryStore());
    expect(normalizeRawInput({ decimals: 5, refreshHz: 30 })).toMatchObject({ decimals: 12, refreshHz: 1 });
    expect(normalizeRawInput({ decimals: "6", refreshHz: "60" })).toMatchObject({ decimals: 12, refreshHz: 1 });
    expect(normalizeRawInput({ decimals: 3, refreshHz: 1 })).toMatchObject({ decimals: 3, refreshHz: 1 });
    expect(parseStored(JSON.stringify({ decimals: 0, refreshHz: 0 }))).toMatchObject({ decimals: 12, refreshHz: 1 });
    expect(await adapter.load()).toBeNull();
  });
});
