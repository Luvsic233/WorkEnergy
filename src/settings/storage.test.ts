import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT } from "../core/settings";
import {
  createAdapter,
  localStorageAdapter,
  normalizeRawInput,
  parseStored,
  readStoredSizePreset,
  STORAGE_KEY,
  type KeyValueStore,
} from "./storage";

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

  it("falls back to 18 digits at 10Hz for a legacy record without the new fields", async () => {
    const store = memoryStore();
    store.data.set(STORAGE_KEY, JSON.stringify({ salary: "15000" }));

    const loaded = await createAdapter(() => store).load();

    expect(loaded?.decimals).toBe(18);
    expect(loaded?.refreshHz).toBe(10);
  });

  it("rejects stored tiers that the panel never offers, including the retired 3", async () => {
    const adapter = createAdapter(() => memoryStore());
    expect(normalizeRawInput({ decimals: 5, refreshHz: 30 })).toMatchObject({ decimals: 18, refreshHz: 10 });
    expect(normalizeRawInput({ decimals: "6", refreshHz: "60" })).toMatchObject({ decimals: 18, refreshHz: 10 });
    expect(normalizeRawInput({ decimals: 3, refreshHz: 10 })).toMatchObject({ decimals: 18, refreshHz: 10 });
    expect(parseStored(JSON.stringify({ decimals: 0, refreshHz: 0 }))).toMatchObject({ decimals: 18, refreshHz: 10 });
    expect(await adapter.load()).toBeNull();
  });

  it("keeps an explicitly stored 18 / 12 / 6 tier", () => {
    expect(normalizeRawInput({ decimals: 18 })).toMatchObject({ decimals: 18 });
    expect(normalizeRawInput({ decimals: 12 })).toMatchObject({ decimals: 12 });
    expect(normalizeRawInput({ decimals: 6 })).toMatchObject({ decimals: 6 });
  });
});

describe("storage of the display mode", () => {
  it("round-trips the display mode through the store", async () => {
    const store = memoryStore();
    const adapter = createAdapter(() => store);
    const saved = { ...DEFAULT_INPUT, displayMode: "jump" as const };

    await adapter.save(saved);

    expect(JSON.parse(store.data.get(STORAGE_KEY) as string)).toMatchObject({ displayMode: "jump" });
    expect(await adapter.load()).toEqual(saved);
  });

  it("falls back to roll for a legacy record without the display mode", async () => {
    const store = memoryStore();
    store.data.set(STORAGE_KEY, JSON.stringify({ salary: "15000" }));

    expect((await createAdapter(() => store).load())?.displayMode).toBe("roll");
  });

  it("falls back to roll for a display mode the panel never offers", () => {
    expect(normalizeRawInput({ displayMode: "smooth" })).toMatchObject({ displayMode: "roll" });
    expect(normalizeRawInput({ displayMode: "ROLL" })).toMatchObject({ displayMode: "roll" });
    expect(normalizeRawInput({ displayMode: "" })).toMatchObject({ displayMode: "roll" });
    expect(normalizeRawInput({ displayMode: true })).toMatchObject({ displayMode: "roll" });
    expect(parseStored(JSON.stringify({ displayMode: 1 }))).toMatchObject({ displayMode: "roll" });
  });

  it("keeps an explicitly stored roll or jump", () => {
    expect(normalizeRawInput({ displayMode: "roll" })).toMatchObject({ displayMode: "roll" });
    expect(normalizeRawInput({ displayMode: "jump" })).toMatchObject({ displayMode: "jump" });
  });
});

describe("storage of the window size preset", () => {
  it("round-trips the size preset through the store", async () => {
    const store = memoryStore();
    const adapter = createAdapter(() => store);
    const saved = { ...DEFAULT_INPUT, sizePreset: "standard" as const };

    await adapter.save(saved);

    expect(JSON.parse(store.data.get(STORAGE_KEY) as string)).toMatchObject({ sizePreset: "standard" });
    expect(await adapter.load()).toEqual(saved);
  });

  it("keeps every whitelisted tier and its own default", () => {
    for (const sizePreset of ["compact", "standard", "wide"] as const) {
      expect(normalizeRawInput({ sizePreset })).toMatchObject({ sizePreset });
    }
  });

  it("falls back to compact for a legacy record without the size preset", async () => {
    const store = memoryStore();
    store.data.set(STORAGE_KEY, JSON.stringify({ salary: "15000" }));

    const loaded = await createAdapter(() => store).load();
    expect(loaded?.sizePreset).toBe("compact");
    expect(normalizeRawInput({ salary: "15000" })).toMatchObject({ sizePreset: "compact" });
    expect(normalizeRawInput({})).toMatchObject({ sizePreset: "compact" });
  });

  it("rejects stored sizes the panel never offers", () => {
    for (const bad of ["huge", "Compact", "", "small", 300, true, null]) {
      expect(normalizeRawInput({ sizePreset: bad })).toMatchObject({ sizePreset: "compact" });
    }
    expect(parseStored(JSON.stringify({ sizePreset: "wide" }))).toMatchObject({ sizePreset: "wide" });
    expect(parseStored(JSON.stringify({ sizePreset: "big" }))).toMatchObject({ sizePreset: "compact" });
  });

  it("reads the preset synchronously at startup, degrading to compact without storage", () => {
    // node 环境没有 localStorage：同步读必须回落默认档而不是抛错
    expect(readStoredSizePreset()).toBe("compact");
  });
});
