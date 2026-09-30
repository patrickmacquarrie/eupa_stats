import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import { findNameIssues, likelySame, mergeName, resolveInput, unmergeName, type Alias } from "../src/lib/names";
import { seasonFromFixture } from "../src/lib/season";

const load = (f: string) => seasonFromFixture(JSON.parse(readFileSync(`fixtures/${f}.json`, "utf8"))).season;

describe("name matching", () => {
  it("catches typos and short first names, not different people", () => {
    expect(likelySame("Katelyn Wiskell", "Katelynn Wiskell")).toMatch(/1 letter/);
    expect(likelySame("Jess Van Os sub", "Jessica Van Os")).toMatch(/short form/);
    expect(likelySame("Vanessa Chow", "Vanessa Chow Sub")).toMatch(/Sub/);
    expect(likelySame("Calvin Li", "Logan Li")).toBeNull();
    expect(likelySame("Ovina Chow", "Vanessa Chow")).toBeNull();
  });

  it("suggests the right player for every unmatched spelling in the real seasons", () => {
    const sugg = (f: string) => Object.fromEntries(findNameIssues(load(f).input).unknown.map((u) => [u.name, u.suggestion]));
    expect(sugg("fall-2026")).toEqual({ "Katelyn Wiskell": "Katelynn Wiskell" });
    expect(sugg("thursday-s1-2026")).toEqual({ "Jared Dembecki Sub": "Jared Dembicki", "Jess Van Os sub": "Jessica Van Os" });
  });
});

describe("merging", () => {
  it("folds every old Sub record in with no salary or cap change", () => {
    for (const f of ["fall-2026", "thursday-s1-2026"]) {
      const s = load(f);
      const before = computeLeague(s.input);
      let input = s.input, aliases: Alias[] = [];
      for (const r of findNameIssues(input).subRecords)
        ({ input, aliases } = mergeName(input, aliases, r.player.name, r.base?.name ?? r.player.name.replace(/\s+sub$/i, "")));
      expect(findNameIssues(input, aliases).subRecords).toHaveLength(0);
      const after = computeLeague(resolveInput(input, aliases));
      const w = s.input.throughWeek;
      for (const p of input.players) if (before.salary[p.name]) expect(after.salary[p.name][w]).toBeCloseTo(before.salary[p.name][w], 0);
      expect(after.capByWeek[w]).toBeCloseTo(before.capByWeek[w], 0);
    }
  });

  it("fixing the Katelyn/Katelynn split credits Jennifer Blaser the full sub night", () => {
    const s = load("fall-2026");
    const before = computeLeague(s.input);
    const m = mergeName(s.input, [], "Katelyn Wiskell", "Katelynn Wiskell");
    const after = computeLeague(resolveInput(m.input, m.aliases));
    expect(after.salary["Jennifer Blaser"][3] - before.salary["Jennifer Blaser"][3]).toBe(100000);
    expect(after.warnings.some((w) => w.includes("Katelyn Wiskell"))).toBe(false);
  });

  it("undoes a rename and a removal", () => {
    const s = load("fall-2026");
    const r = mergeName(s.input, [], "Vanessa Chow Sub", "Vanessa Chow");
    expect(r.input.players.some((p) => p.name === "Vanessa Chow")).toBe(true);
    const u = unmergeName(r.input, r.aliases, r.aliases[0]);
    expect(u.input.players.some((p) => p.name === "Vanessa Chow Sub")).toBe(true);
    expect(u.input).toEqual(s.input);
    const d = mergeName(s.input, [], "Dani Dugan Sub", "Dani Dugan");
    expect(d.input.players).toHaveLength(s.input.players.length - 1);
    expect(unmergeName(d.input, d.aliases, d.aliases[0]).input.players).toHaveLength(s.input.players.length);
  });
});

it("undo after overlapping merges restores the original results exactly", () => {
  const s = load("thursday-s1-2026");
  const base = computeLeague(s.input);
  let input = s.input, aliases: Alias[] = [];
  ({ input, aliases } = mergeName(input, aliases, "Jared Dembecki Sub", "Jared Dembicki"));
  ({ input, aliases } = mergeName(input, aliases, "Jared Dembicki Sub", "Jared Dembicki"));
  ({ input, aliases } = unmergeName(input, aliases, aliases[0]));
  ({ input, aliases } = unmergeName(input, aliases, aliases[0]));
  const after = computeLeague(resolveInput(input, aliases));
  expect(after.salary).toEqual(base.salary);
});
