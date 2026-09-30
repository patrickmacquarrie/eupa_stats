import { useEffect, useRef, useState } from "react";

// The app's own confirmation dialog. The browser's confirm() is blocked when the app is
// embedded (it answers "no" without showing anything), and it's awkward on a tablet anyway.
type Request = { message: string; ok: string; danger: boolean; resolve: (v: boolean) => void };
let show: ((r: Request) => void) | null = null;

export function askConfirm(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) { resolve(false); return; }
    show({ message, ok: opts.ok ?? "OK", danger: opts.danger ?? false, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<Request | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { show = setReq; return () => { show = null; }; }, []);
  useEffect(() => { if (req) okRef.current?.focus(); }, [req]);
  if (!req) return null;
  const done = (v: boolean) => { req.resolve(v); setReq(null); };
  return (
    <div className="modal-backdrop" onClick={() => done(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg"
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") done(false); }}>
        <p id="confirm-msg">{req.message}</p>
        <div className="row gap-sm modal-actions">
          <button onClick={() => done(false)}>Cancel</button>
          <button ref={okRef} className={req.danger ? "primary danger-fill" : "primary"} onClick={() => done(true)}>{req.ok}</button>
        </div>
      </div>
    </div>
  );
}
