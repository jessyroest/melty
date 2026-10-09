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
  { id: "how-link", label: "links and words" },
  { id: "how-dont", label: "what we don't do" },
  { id: "how-tech", label: "the technical bits" },
];

const STEPS: { tag: string; title: string; body: ReactNode }[] = [
  {
    tag: "crypto.getRandomValues",
    title: "you open a room",
    body: (
      <>
        your browser makes two random 32-byte values: the <strong>room key</strong> (AES-256-GCM, non-extractable,
        never in the link) and a <strong>link secret</strong>, which goes after the <code>#</code>:{" "}
        <code>/r#&lt;secret&gt;</code>. it also picks <strong>4 words</strong> for the room. browsers don't send the{" "}
        <code>#</code> part to servers.
      </>
    ),
  },
  {
    tag: "HKDF-SHA256",
    title: "the link points, it doesn't unlock",
    body: (
      <>
        from the link secret your browser derives a <strong>room id</strong>, which is sent to the relay, and a{" "}
        <strong>pre-shared key</strong> that proves you were given the link. the link no longer holds the room key.
      </>
    ),
  },
  {
    tag: "X25519 + ML-KEM-768",
    title: "someone inside hands over the key",
    body: (
      <>
        a newcomer and someone already inside run a hybrid key exchange: classic X25519 plus post-quantum ML-KEM-768,
        with fresh keys every time. the room key travels sealed with the result. with the link, the pre-shared key is
        mixed in, so the relay can't sit in the middle.
      </>
    ),
  },
  {
    tag: "4 words + 6 safety words",
    title: "or someone says the words",
    body: (
      <>
        the 4 words only find the room. a knock waits in a lobby that sees no messages until a person inside lets them
        in. then both see 6 safety words, made from the key exchange. say them out loud: same words, nobody in the
        middle.
      </>
    ),
  },
  {
    tag: "AES-256-GCM",
    title: "every message is sealed",
    body: (
      <>
        chat messages and join / leave / nickname notices are padded to one of three fixed sizes and encrypted with a
        fresh random IV. the room id, your random sender id and a counter go in the additional data, so a replayed
        message is refused. the relay receives <code>{"{iv, ct}"}</code> and nothing else.
      </>
    ),
  },
  {
    tag: "expiresAt",
    title: "it melts",
    body: (
      <>
        the relay forwards ciphertext and stores only the expiry time, a hash of the creator's proof (so the creator keeps the controls after a reconnect), and, for the words, which room they point to.
        an alarm fires: it tells everyone, closes every connection and deletes the room and its words. your browser
        zeroes the secrets and drops the key and the messages, which only ever lived in memory.
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
    <strong>recorded traffic being read later,</strong> including by a future quantum computer: the key travels
    through a hybrid post-quantum exchange, and a link found after the room melted opens nothing.{" "}
    <a href="#how-link">read the details</a>.
  </>,
  <>
    <strong>a relay in the middle of a link join,</strong> and of a words join once you've compared the safety
    words.
  </>,
  <>
    <strong>replayed messages.</strong> a counter per sender means the relay can't play a message to you twice.
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
    <strong>someone forwarding the link.</strong> while someone is inside, whoever has it gets the key and can post
    under any nickname, including fake "joined", "left" or rename notices. nicknames are not verified.
  </>,
  <>
    <strong>where the link travels:</strong> the messenger you shared it in, your clipboard, browser history. opening a
    room link leaves it in your browser history (measured in Edge and Chrome). it no longer holds the key, but it gets
    you in while the room is open. pasting it into "join a room" avoids the history.
  </>,
  <>
    <strong>skipping the safety words.</strong> the relay knows the 4 words. if a knock is let in and nobody compares
    the 6 words, the relay could have been the one knocking, or sat in the middle.
  </>,
  <>
    <strong>metadata.</strong> the relay and Cloudflare see IP addresses, connection times, how many people are in a
    room, the room id (not secret, it doesn't reveal the key), and message timing. sizes only in three steps. the relay
    writes no logs, but the data passes through Cloudflare.
  </>,
  <>
    <strong>a malicious relay</strong> dropping, delaying or reordering messages, or replaying old ones to someone who
    joined after they were sent. it still can't read or forge them.
  </>,
  <>
    <strong>burn after reading being final.</strong> it removes a message from screens running this app, 10 seconds
    after it's opened. it can't stop a screenshot, a modified app, or someone copying it in those 10 seconds.
  </>,
  <>
    <strong>perfect memory wiping.</strong> in JavaScript it's best effort: the secrets' bytes are zeroed, but the
    garbage collector decides when the rest is really gone.
  </>,
];

const DONT: { title: string; body: string }[] = [
  { title: "no accounts", body: "no sign-up, no email, no phone number. open a room and talk." },
  { title: "no tracking", body: "no analytics, no cookies, no web storage. the offline cache holds the app, never messages." },
  { title: "no third parties", body: "no third-party scripts or fonts. we host our own." },
  { title: "no file uploads", body: "just text, up to 4 KB per message." },
  { title: "no relay logs", body: "the relay writes no logs. the data still passes through Cloudflare." },
  { title: "no history", body: "late joiners see nothing sent before they arrived." },
];

const SPEC: [string, ReactNode][] = [
  ["room key", "32 random bytes · AES-256-GCM · non-extractable · never in the link"],
  ["link secret", "32 random bytes · in the link after #"],
  ["kdf", "HKDF-SHA256 · salt: 32 zero bytes"],
  ["room id", <>info <q>room-id-v1</q> · 32 bytes · sent to the relay in a WebSocket header, not the URL</>],
  ["link psk", <>info <q>link-psk-v1</q> · authenticates a link join · never leaves the browser</>],
  ["key exchange", <>X25519 + ML-KEM-768, fresh per join · shared = HKDF(x25519 ‖ mlkem, <q>pq-hybrid-v1</q>)</>],
  ["4 words", "EFF short wordlist · 1296⁴ ≈ 2⁴¹ · they find the room, they're not a key · 10 tries per IP per minute"],
  ["safety words", "6 words from SHA-256 of the key exchange transcript"],
  ["message", "padded to 256 / 1024 / 4352 bytes · random 12-byte IV"],
  ["aad", "roomId · sender id (8 random bytes) · counter (replay protection)"],
  ["on the wire", "{iv, ct}"],
  ["relay stores", "expiresAt · for the words: the room id they point to, until expiry"],
  [
    "limits",
    "8 people · 4 KB plaintext · 5 msg/s per connection, 20 per room · 20 new rooms per IP per hour · 60 connection attempts per IP per minute · 4 knocks waiting per room",
  ],
  ["encrypted extras", "typing notices · reactions · burn-after-read flag, all inside the ciphertext"],
  ["creator proof", "32 random bytes kept in memory · relay only holds its SHA-256, on open sockets, never in storage"],
  ["creator can", "lock the room (no newcomers, knocks sent away) · melt it now (wiped for everyone)"],
  ["not yet", "re-keying when someone leaves · post-quantum signatures · hiding message timing"],
  ["audit", "not independently audited (yet)"],
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
          <p className="how-eyebrow mono">how it works · phase 2</p>
          <h1 className="how-h1">
            the link opens
            <br />
            the door.
          </h1>
          <p className="how-hero__lead">
            your browser seals every message before it leaves. the relay passes sealed envelopes along and keeps only
            an expiry time. here's exactly how, and where it stops.
          </p>
          <p className="how-hero__audit mono">not independently audited (yet).</p>
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
            diagram: your browser creates a 32-byte link secret and puts it in the link after the hash, as
            /r#secret. HKDF derives two values from it: a room id, which is sent to the relay, and a pre-shared key,
            which stays in your browser. the room key is separate and never in the link. you share the link yourself;
            the secret part never reaches the relay. the other browsers get the room key from someone inside, through
            a post-quantum key exchange. messages leave your browser as ciphertext, go through the relay, which stores
            only the expiry time and a hash of the creator's proof, and reach the others. at expiry the room is deleted and every browser drops the
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
              someone inside holds the key.
            </h2>
            <p>
              a link still gets anyone in, automatically, as long as someone is inside to hand over the key. so treat it
              like the conversation while the room is open. once the room has melted, a link found in a history or a
              chat log opens nothing, and recorded traffic can't be decrypted with it.
            </p>
            <p>
              the 4 words are easier to say, and weaker: the relay knows them. that's why a person has to let a knock in,
              and why you compare the 6 safety words. if they differ, leave: someone may be in the middle.
            </p>
            <p className="how-link__note">
              the room key is the same for the whole room, so someone who gets in while it's open can read what was sent
              before, if they also recorded the traffic. there is no re-keying when someone leaves.
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
