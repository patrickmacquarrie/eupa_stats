import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { saveSeason, loadSeason, listSeasons, saveDraft, loadDraft, clearDraft, storageMessage } = await import("../src/lib/store");

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

describe("a game's two copies on the tablet: the newer always wins", () => {
  const local = new Map<string, string>();
  let localBlocked = false;
  const ls = {
    getItem: (k: string) => { if (localBlocked) throw new Error("blocked"); return local.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (localBlocked) throw new Error("blocked"); local.set(k, v); },
  };
  const game = (plays: number) => ({ seasonId: "g1", events: Array.from({ length: plays }, (_, i) => ({ i })) } as any);
  let clock = 1_000;
  beforeEach(() => {
    vi.stubGlobal("localStorage", ls);
    vi.spyOn(Date, "now").mockImplementation(() => ++clock);
    local.clear(); localBlocked = false; fail.on = false;
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("keeps the newest plays when the database copy stops saving mid-game", async () => {
    expect(await saveDraft(game(5))).toEqual({ local: true, db: true });
    fail.on = true;                                   // IndexedDB full from here on
    expect(await saveDraft(game(6))).toEqual({ local: true, db: false });
    expect(await saveDraft(game(7))).toEqual({ local: true, db: false });
    fail.on = false;
    expect((await loadDraft("g1"))?.events).toHaveLength(7);
  });

  it("keeps the newest plays when the quick copy is blocked", async () => {
    await saveDraft(game(3));
    localBlocked = true;
    expect(await saveDraft(game(4))).toEqual({ local: false, db: true });
    expect((await loadDraft("g1"))?.events).toHaveLength(4);
  });

  it("survives 1,000 saves with either copy failing at random, always returning the last save", async () => {
    let r = 7;
    const coin = () => { r = (r * 1103515245 + 12345) % 2147483648; return r % 4; };
    let lastSaved = 0;
    for (let n = 1; n <= 1000; n++) {
      const c = coin();
      localBlocked = c === 1; fail.on = c === 2;      // never both: the tablet warns when both fail
      const saved = await saveDraft(game(n));
      if (saved.local || saved.db) lastSaved = n;
      localBlocked = false; fail.on = false;
      if (n % 50 === 0) expect((await loadDraft("g1"))?.events, `after save ${n}`).toHaveLength(lastSaved);
    }
  });

  it("a finished game cleared from the tablet stays cleared", async () => {
    await saveDraft(game(9));
    await clearDraft("g1");
    expect(await loadDraft("g1")).toBeNull();
  });
});
