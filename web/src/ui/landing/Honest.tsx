import { useRef } from "react";
import { navigate } from "../../lib/router";
import { useInView } from "./hooks";

// ---- honesty: four limits, drawn as cracks in one pane of ice ----------------------

const LIMITS = [
  { title: "stop screenshots.", body: "anyone in the room can still capture the screen." },
  { title: "check who has the link.", body: "whoever holds it gets in while the room is open. share it carefully." },
  { title: "save a compromised device.", body: "malware or a shady browser extension sees what you see." },
  {
    title: "hide that you were there.",
    body: "the server and Cloudflare see IP addresses and timing. never the content.",
  },
];

// one impact in the middle; the main cracks split the pane into four shards
const MAIN = [
  "M500 280 L497 252 L510 205 L502 150 L518 92 L506 40 L512 -10",
  "M500 280 L508 318 L494 372 L506 430 L490 490 L498 570",
  "M500 280 L452 274 L398 286 L330 270 L262 282 L190 266 L120 280 L50 270 L-10 278",
  "M500 280 L556 290 L612 278 L684 294 L752 284 L830 298 L902 288 L1010 296",
];
const BRANCHES = [
  "M500 280 L528 262 L552 258",
  "M500 280 L474 300 L452 304",
  "M500 280 L520 306 L522 330",
  "M500 280 L482 254 L484 230",
  "M330 270 L322 238 L330 214",
  "M684 294 L696 326",
  "M506 430 L530 446",
  "M518 92 L546 82",
  "M190 266 L176 300",
  "M830 298 L846 262",
];

function PaneCracks() {
  return (
    <svg className="hn-cracks" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className="hn-cracks__soft">
        {MAIN.map((d) => (
          <path key={d} d={d} pathLength={1} />
        ))}
      </g>
      <g className="hn-cracks__main">
        {MAIN.map((d, i) => (
          <path key={d} d={d} pathLength={1} style={{ ["--i" as string]: i }} />
        ))}
      </g>
      <g className="hn-cracks__branch">
        {BRANCHES.map((d, i) => (
          <path key={d} d={d} pathLength={1} style={{ ["--i" as string]: i }} />
        ))}
      </g>
      <circle className="hn-cracks__impact" cx="500" cy="280" r="9" />
      <circle className="hn-cracks__dot" cx="500" cy="280" r="2.6" />
    </svg>
  );
}

function ItemCrack() {
  return (
    <svg className="hn-item__crack" viewBox="0 0 300 14" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 7 L38 4 L76 10 L118 5 L166 9 L212 3 L258 8 L300 6" />
    </svg>
  );
}

export function Honest() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.3);
  return (
    <section className="l-section l-honest">
      <div className="hn-head">
        <div>
          <p className="hn-eyebrow mono">the fine print, in large print</p>
          <h2 className="h-xl">
            what melty
            <br />
            can't do.
          </h2>
        </div>
        <div>
          <p className="lead">ice is upfront about being temporary. we try to be upfront about the rest.</p>
          <a
            className="link-arrow"
            href="/how"
            onClick={(e) => {
              e.preventDefault();
              navigate("/how");
            }}
          >
            read the full threat model →
          </a>
        </div>
      </div>

      <div ref={ref} className={`hn-pane${seen ? " is-in" : ""}`}>
        <PaneCracks />
        <ul className="hn-list">
          {LIMITS.map((l, i) => (
            <li key={l.title} className="hn-item" style={{ ["--i" as string]: i }}>
              {i > 0 && <ItemCrack />}
              <p className="hn-item__no mono">crack 0{i + 1}</p>
              <h3 className="hn-item__title">
                <span className="hn-item__cant">can't</span> {l.title}
              </h3>
              <p className="hn-item__body">{l.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
