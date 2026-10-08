import { navigate } from "../../lib/router";

// ---- honesty --------------------------------------------------------------------

export function Honest() {
  return (
    <section className="l-section l-honest">
      <div>
        <h2 className="h-xl">
          what melty
          <br />
          can't do.
        </h2>
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
      <ul className="l-honest__list">
        <li>
          <strong>stop screenshots.</strong> anyone in the room can still capture the screen.
        </li>
        <li>
          <strong>check who has the link.</strong> whoever holds it can read along. share it carefully.
        </li>
        <li>
          <strong>save a compromised device.</strong> malware or a shady browser extension sees what you see.
        </li>
        <li>
          <strong>hide that you were there.</strong> the server and Cloudflare see IP addresses and timing. never the
          content.
        </li>
      </ul>
    </section>
  );
}
