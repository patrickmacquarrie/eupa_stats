/**
 * A spinner with its label. It fades in after a moment, so a quick load never flashes; the label
 * stays readable for screen readers and with reduced motion.
 */
export function Loading({ label = "Loading…", pad }: { label?: string; pad?: boolean }) {
  return (
    <p className={"loading" + (pad ? " pad" : "")} role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </p>
  );
}
