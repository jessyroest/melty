import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mascot } from "./Mascot";
import { CheckIcon, CloseIcon, CopyIcon, EyeIcon, ShareIcon } from "./RoomIcons";
import { useSheet } from "./RoomSheet";

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

type CopyState = "idle" | "copied" | "manual";

export function ShareSheet({ link, onClose }: { link: string; onClose: () => void }) {
  const copyBtn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { ref, onClick } = useSheet(onClose, copyBtn);
  const [copied, setCopied] = useState<CopyState>("idle");
  const [burst, setBurst] = useState(0);
  const qr = useMemo(() => qrPath(link), [link]);
  const canShare = typeof navigator.share === "function";

  useEffect(() => {
    if (copied === "idle") return;
    const t = setTimeout(() => setCopied("idle"), 2400);
    return () => clearTimeout(t);
  }, [copied, burst]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("copied");
      setBurst((b) => b + 1);
    } catch {
      // no clipboard access: select the text so a manual copy works
      input.current?.select();
      setCopied("manual");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "melty room", url: link });
    } catch {
      // cancelled, or not allowed: nothing to do
    }
  }

  return (
    <dialog ref={ref} className="sheet sheet--share" aria-labelledby="share-title" onClose={onClose} onClick={onClick}>
      <div className="sheet__head">
        <div>
          <span className="sheet__kicker mono">invite</span>
          <h2 id="share-title">bring people in</h2>
        </div>
        <button className="sheet__close" type="button" onClick={onClose} aria-label="close">
          <CloseIcon />
        </button>
      </div>

      <p className="warn">
        <EyeIcon className="warn__icon" />
        <span>
          <strong>anyone with this link can read along.</strong> the key is in the link itself. share it only with the
          people you mean, through a channel you trust.
        </span>
      </p>

      <div className="r-share">
        <figure className="r-iceframe">
          <div className="r-iceframe__block">
            <div className="r-iceframe__glass">
              <svg
                className="r-iceframe__qr"
                viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
                role="img"
                aria-label="QR code of the room link"
                shapeRendering="crispEdges"
              >
                <rect x="-2" y="-2" width={qr.size + 4} height={qr.size + 4} fill="#fff" />
                <path d={qr.d} fill="#0B1530" />
              </svg>
              <span className="r-iceframe__glint" aria-hidden="true" />
            </div>
            <Mascot left={1} size={58} className="r-iceframe__mascot" />
            <svg className="r-iceframe__drips" viewBox="0 0 120 16" aria-hidden="true" focusable="false">
              <path d="M14 0h10q0 6-5 12-5-6-5-12z" />
              <path className="r-iceframe__drip--slow" d="M62 0h8q0 4-4 9-4-5-4-9z" />
              <path d="M96 0h12q0 8-6 15-6-7-6-15z" />
            </svg>
          </div>
          <figcaption>scan to join. same rule: whoever scans it is in.</figcaption>
        </figure>

        <div className="r-share__side">
          <label className="field">
            <span className="field__label">room link</span>
            <input
              ref={input}
              className={`input mono r-share__link${copied === "copied" ? " is-copied" : ""}`}
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <button
            ref={copyBtn}
            className={`btn btn--primary r-copy${copied === "copied" ? " is-copied" : ""}`}
            type="button"
            onClick={() => void copy()}
          >
            <span className="r-copy__face" key={copied}>
              {copied === "copied" ? <CheckIcon /> : <CopyIcon />}
              {copied === "copied" ? "copied" : copied === "manual" ? "selected. copy it yourself" : "copy link"}
            </span>
            {burst > 0 && (
              <span key={burst} className="r-copy__burst" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            )}
          </button>
          {canShare && (
            <button className="btn btn--ghost r-share__native" type="button" onClick={() => void share()}>
              <ShareIcon />
              share…
            </button>
          )}
          <span className="sr-only" role="status">
            {copied === "copied" ? "link copied" : copied === "manual" ? "link selected" : ""}
          </span>
          <p className="r-share__note">
            the part after <code>#</code> is the key. it never reaches the server.
          </p>
        </div>
      </div>
    </dialog>
  );
}
