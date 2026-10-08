import { Mascot } from "./Mascot";

export function HowItWorks() {
  return (
    <article className="how">
      <header className="how__head">
        <Mascot left={0.6} size={88} />
        <h1>how it works</h1>
        <p className="lead">short version: the link is the key. the server only passes sealed envelopes around.</p>
      </header>

      <section className="panel how__section">
        <h2>what happens</h2>
        <ol>
          <li>
            when you open a room, your browser makes a random 32-byte secret and puts it in the link, after the{" "}
            <code>#</code>. browsers never send that part to a server.
          </li>
          <li>
            from that secret, your browser derives two things (HKDF-SHA256): a room id, which the relay sees, and an
            AES-256-GCM key, which never leaves your browser and can't be read back out of it.
          </li>
          <li>
            every message, and every "joined" / "left" notice, is encrypted with that key before it's sent. the relay
            gets a random IV and ciphertext, passes it on to whoever else is connected, and forgets it.
          </li>
          <li>
            the relay stores one thing: when the room expires. at that moment it closes every connection and deletes
            the room. for a day after that, it refuses that room id, then deletes that note too.
          </li>
          <li>
            your browser keeps the key and messages in memory only. no local storage, no cookies. leaving, closing the
            tab or the timer running out drops all of it.
          </li>
        </ol>
      </section>

      <section className="panel how__section">
        <h2>what this protects against</h2>
        <ul className="list list--yes">
          <li>the server (or anyone who breaks into it) reading your messages. it never has the key.</li>
          <li>
            chat history piling up somewhere. messages aren't stored on the server, and they disappear from your tab
            when the room ends.
          </li>
          <li>
            recorded traffic being read later, as long as the link stays secret. note: the link is the key. anyone who
            gets it later, together with recorded traffic, can decrypt that traffic.
          </li>
        </ul>
      </section>

      <section className="panel how__section">
        <h2>what it does not protect against</h2>
        <ul className="list list--no">
          <li>screenshots, or someone photographing a screen.</li>
          <li>a compromised device, or a malicious browser extension. those see what you see.</li>
          <li>anyone who has the link. if it's forwarded, the new person can read along and post as any nickname.</li>
          <li>
            where the link travels. it can end up in the chat app you used to share it, your clipboard, or your browser
            history (we remove it from the address bar right after opening, but the browser may have recorded it).
          </li>
          <li>
            the server and Cloudflare seeing metadata: IP addresses, when you're connected, how many people are in a
            room, and the size and timing of messages. we don't log any of it, but it's visible to them.
          </li>
          <li>
            a misbehaving relay dropping, delaying, reordering or replaying messages. it can't read or forge them.
          </li>
          <li>nicknames are not verified. there's no proof of who is who.</li>
        </ul>
      </section>

      <section className="panel how__section">
        <h2>what we don't do</h2>
        <ul className="list">
          <li>no accounts, no analytics, no tracking, no third-party scripts or fonts.</li>
          <li>no file uploads.</li>
          <li>the relay writes no logs.</li>
        </ul>
      </section>
    </article>
  );
}
