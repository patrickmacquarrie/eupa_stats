// Checks for a new league's link name and passwords. Kept apart from league.ts so the forms that
// use them don't load Firebase until something is actually sent.
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const slugProblem = (s: string) =>
  SLUG.test(s) ? null : "Use 3 to 40 lower-case letters, numbers and dashes, starting and ending with a letter or number.";
export const passwordProblem = (p: string) => (p.length >= 6 ? null : "Use at least 6 characters.");
/** A link name from a league's name: "EUPA Fall League" → "eupa-fall-league". */
export const slugFrom = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** What's wrong with a new league's form, or null when it can be created. */
export function newLeagueProblem(f: { name: string; slug: string; stat: string; admin: string; admin2: string }) {
  return !f.name.trim() ? "Give the league a name." : slugProblem(f.slug) ?? passwordProblem(f.stat) ?? passwordProblem(f.admin)
    ?? (f.admin !== f.admin2 ? "The two admin passwords don't match." : f.stat === f.admin ? "Use different passwords for stats entry and admin." : null);
}
