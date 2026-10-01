import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import { findNameIssues, likelySame, mergeName, resolveInput, unmergeName, type Alias } from "../src/lib/names";
import { seasonFromFixture } from "../src/lib/season";

const load = (f: string) => seasonFromFixture(JSON.parse(readFileSync(`fixtures/${f}.json`, "utf8"))).season;

describe("name matching", () => {
  it("catches typos and short first names, not different people", () => {
    expect(likelySame("Bettany Cranleighq", "Bettany Cranleigh")).toMatch(/1 letter/);
    expect(likelySame("Rave Lindqvist sub", "Ravenna Lindqvist")).toMatch(/short form/);
    expect(likelySame("Leopold Rookwood", "Leopold Rookwood Sub")).toMatch(/Sub/);
    expect(likelySame("Dashiell Ashgrove", "Quillon Ashgrove")).toBeNull();
    expect(likelySame("Peregrine Oakenshaw", "Leopold Rookwood")).toBeNull();
  });

  it("suggests the right player for every unmatched spelling in the real seasons", () => {
    const sugg = (f: string) => Object.fromEntries(findNameIssues(load(f).input).unknown.map((u) => [u.name, u.suggestion]));
    expect(sugg("fall-2026")).toEqual({ "Bettany Cranleighq": "Bettany Cranleigh" });
    expect(sugg("thursday-s1-2026")).toEqual({ "Alder Oakenshawx Sub": "Alder Oakenshaw", "Rave Lindqvist sub": "Ravenna Lindqvist" });
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

  it("fixing the Katelyn/Katelynn split credits Peregrine Ashgrove the full sub night", () => {
    const s = load("fall-2026");
    const before = computeLeague(s.input);
    const m = mergeName(s.input, [], "Bettany Cranleighq", "Bettany Cranleigh");
    const after = computeLeague(resolveInput(m.input, m.aliases));
    expect(after.salary["Peregrine Ashgrove"][3] - before.salary["Peregrine Ashgrove"][3]).toBe(100000);
    expect(after.warnings.some((w) => w.includes("Bettany Cranleighq"))).toBe(false);
  });

  it("undoes a rename and a removal", () => {
    const s = load("fall-2026");
    const r = mergeName(s.input, [], "Leopold Rookwood Sub", "Leopold Rookwood");
    expect(r.input.players.some((p) => p.name === "Leopold Rookwood")).toBe(true);
    const u = unmergeName(r.input, r.aliases, r.aliases[0]);
    expect(u.input.players.some((p) => p.name === "Leopold Rookwood Sub")).toBe(true);
    expect(u.input).toEqual(s.input);
    const d = mergeName(s.input, [], "Alder Rookwood Sub", "Alder Rookwood");
    expect(d.input.players).toHaveLength(s.input.players.length - 1);
    expect(unmergeName(d.input, d.aliases, d.aliases[0]).input.players).toHaveLength(s.input.players.length);
  });
});

it("undo after overlapping merges restores the original results exactly", () => {
  const s = load("thursday-s1-2026");
  const base = computeLeague(s.input);
  let input = s.input, aliases: Alias[] = [];
  ({ input, aliases } = mergeName(input, aliases, "Alder Oakenshawx Sub", "Alder Oakenshaw"));
  ({ input, aliases } = mergeName(input, aliases, "Alder Oakenshaw Sub", "Alder Oakenshaw"));
  ({ input, aliases } = unmergeName(input, aliases, aliases[0]));
  ({ input, aliases } = unmergeName(input, aliases, aliases[0]));
  const after = computeLeague(resolveInput(input, aliases));
  expect(after.salary).toEqual(base.salary);
});
