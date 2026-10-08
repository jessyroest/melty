import type { ReactNode } from "react";
import { navigate } from "../lib/router";
import { HowDiagram } from "./HowDiagram";
import { HowToc, type TocItem } from "./HowToc";
import { focusStart } from "./Home";
import { Frost } from "./landing/Frost";
import { LiveMascot } from "./LiveMascot";
import { Mascot } from "./Mascot";

const TOC: TocItem[] = [
  { id: "how-steps", label: "what happens" },
  { id: "how-threats", label: "threat model" },
  { id: "how-link", label: "the link is the key" },
  { id: "how-dont", label: "what we don't do" },
  { id: "how-tech", label: "the technical bits" },
];

const STEPS: { tag: string; title: string; body: ReactNode }[] = [
  {
    tag: "crypto.getRandomValues",
    title: "you open a room",
    body: (
      <>
        your browser makes a random 32-byte secret and puts it in the link, after the <code>#</code>:{" "}
        <code>/r#&lt;secret&gt;</code>. browsers don't send that part to servers, and your own address bar never shows
        it.
      </>
    ),
  },
  {
    tag: "HKDF-SHA256",
    title: "one secret, two values",
    body: (
      <>
        from the secret your browser derives a <strong>room id</strong>, which is sent to the relay, and an{" "}
        <strong>AES-256-GCM key</strong>, which is non-extractable and never leaves your browser.
      </>
    ),
  },
  {
    tag: "link or QR code",
    title: "you share the link",
    body: (
      <>
        whoever opens it derives the same room id and the same key. the app reads the <code>#</code> part once and
        removes it from the address bar straight away.
      </>
    ),
  },
  {
    tag: "AES-256-GCM",
    title: "every message is sealed",
    body: (
      <>
        chat messages and join / leave / nickname notices are encrypted with a fresh random 12-byte IV, with the room id
        as additional data. the relay receives <code>{"{iv, ct}"}</code> and nothing else.
      </>
    ),
  },
  {
    tag: "one Durable Object per room",
    title: "the relay passes it on",
    body: (
      <>
        it forwards ciphertext to the other people in the room and stores only the expiry time. it also enforces the
        limits: 8 people, 4 KB per message, 5 messages per second per connection.
      </>
    ),
  },
  {
    tag: "expiresAt",
    title: "it melts",
    body: (
      <>
        an alarm fires: the relay tells everyone, closes every connection and deletes the room. for 24 hours it refuses
        that room id, then that note is deleted too. your browser zeroes the secret and drops the key and the messages,
        which only ever lived in memory. leaving or closing the tab does the same.
      </>
    ),
  },
];

const PROTECTS: ReactNode[] = [
  <>
    <strong>the server reading your messages.</strong> the relay never has the key, only the room id and ciphertext.
  </>,
  <>
    <strong>stored chat history.</strong> nothing is stored on the server. browsers keep messages in memory only and
    drop them when the room ends.
  </>,
  <>
    <strong>recorded traffic being read later,</strong> as long as the link stays secret.{" "}
    <a href="#how-link">read the catch</a>.
  </>,
];

const DOESNT: ReactNode[] = [
  <>
    <strong>screenshots,</strong> or photos of the screen.
  </>,
  <>
    <strong>compromised devices</strong> or malicious browser extensions. they see what you see.
  </>,
  <>
    <strong>someone forwarding the link.</strong> whoever has it can read along and post under any nickname. nicknames
    are not verified.
  </>,
  <>
    <strong>where the link travels:</strong> the messenger you shared it in, your clipboard, browser history. the app
    strips it from the address bar right after opening, but the browser may already have recorded the visit.
  </>,
  <>
    <strong>metadata.</strong> the relay and Cloudflare see IP addresses, connection times, how many people are in a
    room, the room id (not secret, it doesn't reveal the key), and message sizes and timing. the relay writes no logs,
    but the data passes through Cloudflare.
  </>,
  <>
    <strong>a malicious relay</strong> dropping, delaying, reordering or replaying messages within a room. there is no
    replay protection or padding yet. it still can't read or forge them.
  </>,
  <>
    <strong>perfect memory wiping.</strong> in JavaScript it's best effort: the secret's bytes are zeroed, but the
    garbage collector decides when the rest is really gone.
  </>,
];

const DONT: { title: string; body: string }[] = [
  { title: "no accounts", body: "no sign-up, no email, no phone number. open a room and talk." },
  { title: "no tracking", body: "no analytics, no cookies, no web storage." },
  { title: "no third parties", body: "no third-party scripts or fonts. we host our own." },
  { title: "no file uploads", body: "just text, up to 4 KB per message." },
  { title: "no logs", body: "the relay writes no logs. the data still passes through Cloudflare." },
  { title: "no history", body: "late joiners see nothing sent before they arrived." },
];

const SPEC: [string, ReactNode][] = [
  ["secret", "32 random bytes · crypto.getRandomValues · in the link after #"],
  ["kdf", "HKDF-SHA256 · salt: 32 zero bytes"],
  ["room id", <>info <q>room-id-v1</q> · 32 bytes · base64url · sent to the relay</>],
  ["key", <>info <q>room-key-v1</q> · AES-256-GCM · non-extractable</>],
  ["iv", "12 random bytes, fresh for every message"],
  ["aad", "roomId"],
  ["on the wire", "{iv, ct}"],
  ["relay stores", "expiresAt"],
  ["limits", "8 people · 4 KB plaintext · 5 msg/s per connection · 20 new rooms per IP per hour"],
  ["not yet", "key exchange · forward secrecy · replay protection · padding"],
];

type HeadProps = { id: string; n: string; eyebrow: string; title: string; children?: ReactNode };

function SectionHead({ id, n, eyebrow, title, children }: HeadProps) {
  return (
    <div className="how-sec__head">
      <p className="how-eyebrow mono">
        <span aria-hidden="true">{n} / </span>
        {eyebrow}
      </p>
      <h2 className="how-h2" id={id}>
        {title}
      </h2>
      {children && <p className="how-sec__lead">{children}</p>}
    </div>
  );
}

function Icicles() {
  return (
    <svg className="how-icicles" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="how-icicle" width="46" height="18" patternUnits="userSpaceOnUse">
          <path d="M0 0 H46 L41 0 Q38 13 35 0 L25 0 Q21 17 17 0 L10 0 Q8 8 6 0 Z" />
        </pattern>
      </defs>
      <rect width="100%" height="18" fill="url(#how-icicle)" />
    </svg>
  );
}

function openRoom() {
  navigate("/");
  requestAnimationFrame(() => requestAnimationFrame(focusStart));
}

export function HowItWorks() {
  return (
    <article className="how">
      <header className="how-hero">
        <Frost density={0.5} />
        <div className="how-hero__text">
          <p className="how-eyebrow mono">how it works · phase 1</p>
          <h1 className="how-h1">
            the link
            <br />
            is the key.
          </h1>
          <p className="how-hero__lead">
            your browser seals every message before it leaves. the relay passes sealed envelopes along and keeps only
            an expiry time. here's exactly how, and where it stops.
          </p>
        </div>
        <LiveMascot size={150} pokeable className="how-hero__mascot" />
      </header>

      <figure className="how-figure">
        <Icicles />
        <HowDiagram />
        <figcaption>
          <ul className="how-legend" aria-hidden="true">
            <li className="how-legend__key">stays in your browser</li>
            <li className="how-legend__wire">goes over the network</li>
            <li className="how-legend__share">travels however you share it</li>
          </ul>
          <p className="sr-only">
            diagram: your browser creates a 32-byte secret and puts it in the link after the hash, as /r#secret. HKDF
            derives two values from it: a room id, which is sent to the relay, and an AES-256-GCM key, which stays in
            your browser. you share the link yourself; the secret part never reaches the relay. messages leave your
            browser as ciphertext, go through the relay, which stores only the expiry time, and reach the other
            browsers, which hold the same key from the link. at expiry the room is deleted and every browser drops the
            key.
          </p>
        </figcaption>
      </figure>

      <div className="how-body">
        <aside className="how-body__side">
          <HowToc items={TOC} />
        </aside>

        <div className="how-body__main">
          <section className="how-sec" id="how-steps" aria-labelledby="how-steps-h">
            <SectionHead id="how-steps-h" n="01" eyebrow="the flow" title="what happens">
              six steps, from opening a room to the moment it melts.
            </SectionHead>
            <ol className="how-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="how-step">
                  <span className="how-step__n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="how-step__body">
                    <p className="how-step__tag mono">{s.tag}</p>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="how-sec" id="how-threats" aria-labelledby="how-threats-h">
            <SectionHead id="how-threats-h" n="02" eyebrow="threat model" title="what it protects against, and what it doesn't" />
            <div className="how-threats">
              <div className="how-card how-card--yes">
                <h3>
                  <span className="how-card__sym" aria-hidden="true">
                    ✓
                  </span>
                  protects against
                </h3>
                <ul>
                  {PROTECTS.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
                <Mascot left={1} size={64} className="how-card__mascot" />
              </div>
              <div className="how-card how-card--no">
                <h3>
                  <span className="how-card__sym" aria-hidden="true">
                    ✕
                  </span>
                  does not protect against
                </h3>
                <ul>
                  {DOESNT.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
                <Mascot left={0.35} size={64} className="how-card__mascot" />
              </div>
            </div>
          </section>

          <section className="how-sec how-link" id="how-link" aria-labelledby="how-link-h">
            <p className="how-eyebrow mono">
              <span aria-hidden="true">03 / </span>the catch
            </p>
            <h2 className="how-h2" id="how-link-h">
              the link is the key.
            </h2>
            <p>
              phase 1 has no key exchange, so there is no forward secrecy. anyone who later gets the link{" "}
              <em>and</em> also has recorded traffic can decrypt it. treat the link like the conversation itself.
            </p>
            <p className="how-link__note">
              a key exchange, so links don't have to carry the key, is planned for phase 2. it isn't built yet.
            </p>
            <Mascot left={0.6} size={150} className="how-link__mascot" />
          </section>

          <section className="how-sec" id="how-dont" aria-labelledby="how-dont-h">
            <SectionHead id="how-dont-h" n="04" eyebrow="by design" title="what we don't do" />
            <ul className="how-dont">
              {DONT.map((d) => (
                <li key={d.title} className="how-dont__item">
                  <h3>{d.title}</h3>
                  <p>{d.body}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="how-sec" id="how-tech" aria-labelledby="how-tech-h">
            <SectionHead id="how-tech-h" n="05" eyebrow="for the curious" title="the technical bits" />
            <div className="how-spec">
              <dl>
                {SPEC.map(([k, v]) => (
                  <div key={k} className="how-spec__row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        </div>
      </div>

      <footer className="how-end">
        <Mascot left={0} size={110} className="how-end__mascot" />
        <p className="how-h2">that's the whole trick.</p>
        <p className="how-end__lead">when the timer runs out, the room is gone. open one and watch it melt.</p>
        <button type="button" className="btn btn--primary" onClick={openRoom}>
          open a room
        </button>
      </footer>
    </article>
  );
}
