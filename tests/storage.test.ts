import { beforeEach, describe, expect, it, vi } from "vitest";

// Simulate the browser refusing storage: IndexedDB full, localStorage missing (as in a
// locked-down or private window).
const fail = { on: false, name: "QuotaExceededError" };
vi.mock("idb-keyval", () => {
  const mem = new Map<string, unknown>();
  const guard = () => { if (fail.on) throw Object.assign(new Error("The quota has been exceeded."), { name: fail.name }); };
  return {
    get: async (k: string) => { guard(); return mem.get(k); },
    set: async (k: string, v: unknown) => { guard(); mem.set(k, v); },
    del: async (k: string) => { guard(); mem.delete(k); },
  };
});

const { saveSeason, loadSeason, listSeasons, saveDraft, storageMessage } = await import("../src/lib/store");

const season = () => ({ id: "s1", name: "Test", source: "", createdAt: "", updatedAt: "", input: {} as any });

describe("storage failures are reported, not swallowed", () => {
  beforeEach(() => { fail.on = false; fail.name = "QuotaExceededError"; });

  it("saves normally, stamping the schema version", async () => {
    const saved = await saveSeason(season());
    expect(saved.schemaVersion).toBe(1);
    expect((await loadSeason("s1"))?.name).toBe("Test");
    expect((await listSeasons()).map((m) => m.id)).toEqual(["s1"]);
  });

  it("a full storage rejects the save with a plain message", async () => {
    fail.on = true;
    await expect(saveSeason(season())).rejects.toThrow("Not saved: This browser's storage for the app is full.");
    await expect(listSeasons()).rejects.toThrow(/Couldn't read your seasons/);
  });

  it("blocked storage is named as such", () => {
    expect(storageMessage(Object.assign(new Error("x"), { name: "SecurityError" }))).toMatch(/private window/);
  });

  it("a game draft reports which copies saved, so the recorder can warn", async () => {
    // No localStorage in this environment, so the backup copy fails too.
    expect(await saveDraft({ seasonId: "s1" } as any)).toEqual({ local: false, db: true });
    fail.on = true;
    expect(await saveDraft({ seasonId: "s1" } as any)).toEqual({ local: false, db: false });
  });
});
