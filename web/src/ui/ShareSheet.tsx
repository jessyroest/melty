import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";

/** Draw the QR code ourselves as one SVG path: no data: URLs, no innerHTML. */
function qrPath(text: string): { d: string; size: number } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = modules.size;
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { d, size };
}

export function ShareSheet({ link, onClose }: { link: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const qr = useMemo(() => qrPath(link), [link]);

  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <dialog ref={ref} className="sheet panel" aria-labelledby="share-title" onClose={onClose}>
      <div className="sheet__head">
        <h2 id="share-title">invite people</h2>
        <button className="btn btn--ghost" type="button" onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>

      <p className="warn">
        <strong>anyone with this link can read along.</strong> the key is in the link itself. share it only with the
        people you mean, through a channel you trust.
      </p>

      <label className="field">
        <span className="field__label">room link</span>
        <input className="input mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <button className="btn btn--primary" type="button" onClick={() => void copy()}>
        {copied ? "copied" : "copy link"}
      </button>
      <span className="sr-only" role="status">
        {copied ? "link copied" : ""}
      </span>

      <figure className="qr">
        <svg
          viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
          role="img"
          aria-label="QR code of the room link"
          shapeRendering="crispEdges"
        >
          <rect x="-2" y="-2" width={qr.size + 4} height={qr.size + 4} fill="#fff" />
          <path d={qr.d} fill="#0B1530" />
        </svg>
        <figcaption>scan to join. same rule: whoever scans it is in.</figcaption>
      </figure>
    </dialog>
  );
}
