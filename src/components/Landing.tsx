import { useEffect, useRef } from 'react';
import './landing.css';
import '@fontsource/bricolage-grotesque/700.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';
import '@fontsource/almarai/400.css';
import '@fontsource/caveat/600.css';

const MARQUEE = (
  <>
    <span>CAPTURE</span>
    <span className="y">✦</span>
    <span>WRITE IT DOWN</span>
    <span className="c">✦</span>
    <span>RETRIEVE ANYWHERE</span>
    <span className="y">✦</span>
    <span>END-TO-END ENCRYPTED</span>
    <span className="c">✦</span>
    <span>WORKS OFFLINE</span>
    <span className="y">✦</span>
    <span>عربي + ENGLISH</span>
    <span className="c">✦</span>
  </>
);

/** Public homepage for signed-out visitors (approved "Ink it. Find it forever."
 * direction). Motion is progressive enhancement: with no JS or reduced motion the
 * page is simply fully visible. */
export function Landing({
  onSignIn,
  onSignUp,
  onUseOffline,
}: {
  onSignIn: () => void;
  onSignUp: () => void;
  onUseOffline: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const floats = Array.from(root.querySelectorAll<HTMLElement>('.float'));
    const onMove = (e: MouseEvent) => {
      const mx = e.clientX / innerWidth - 0.5;
      const my = e.clientY / innerHeight - 0.5;
      for (const el of floats) {
        const d = parseFloat(el.dataset.depth ?? '20');
        el.style.transform = `translate3d(${(-mx * d).toFixed(1)}px,${(-my * d).toFixed(1)}px,0)`;
      }
    };

    const reveals = Array.from(root.querySelectorAll<HTMLElement>('.reveal'));
    reveals.forEach((el) => el.classList.add('pre'));
    const sweep = () => {
      const limit = innerHeight * 0.88;
      for (const el of reveals) {
        if (el.classList.contains('pre') && el.getBoundingClientRect().top < limit) {
          el.classList.remove('pre');
        }
      }
    };

    document.addEventListener('mousemove', onMove, { passive: true });
    root.addEventListener('scroll', sweep, { passive: true });
    window.addEventListener('resize', sweep, { passive: true });
    sweep();
    return () => {
      document.removeEventListener('mousemove', onMove);
      root.removeEventListener('scroll', sweep);
      window.removeEventListener('resize', sweep);
    };
  }, []);

  return (
    <div className="ld" ref={rootRef}>
      <nav>
        <span className="logo">Insightyyy</span>
        <span className="stamp">HAKAMI</span>
        <span className="spacer" />
        <a
          className="pill ghosty"
          href="#how"
          onClick={(e) => {
            e.preventDefault();
            rootRef.current
              ?.querySelector('#how')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          How it works
        </a>
        <button type="button" className="pill dark" onClick={onSignIn}>
          Sign in
        </button>
      </nav>

      <div className="hero">
        <svg className="blob b1" viewBox="0 0 600 520" aria-hidden="true">
          <path
            fill="#FFD84D"
            opacity=".55"
            d="M424 44c74 32 136 96 142 168 7 72-42 151-108 196s-150 56-224 31S102 351 77 275c-24-76-6-163 48-209s133-54 202-39c33 7 63 3 97 17z"
          />
        </svg>
        <svg className="blob b2" viewBox="0 0 600 520" aria-hidden="true">
          <path
            fill="#E8744F"
            opacity=".26"
            d="M398 31c81 21 160 77 176 151 17 74-29 165-99 210-70 46-163 45-237 13S107 302 95 226c-13-77 21-160 83-197 62-38 139-19 220 2z"
          />
        </svg>

        <div className="hero-inner">
          <h1>
            Ink it.
            <br />
            Find it{' '}
            <span className="coral circle">
              forever.
              <svg viewBox="0 0 200 80" aria-hidden="true">
                <path d="M12 48 C 30 12, 168 6, 186 34 C 198 56, 120 76, 52 70 C 18 66, 8 58, 14 46" />
              </svg>
            </span>
          </h1>
          <p className="lede">
            Capture a screenshot, a link, a thought. Insightyyy hands you a short reference —{' '}
            <b>write it in your paper notebook</b> — and from then on, typing it back finds the
            source. On any device. Encrypted so only you can read it.
          </p>
          <div className="cta-row">
            <button type="button" className="pill coral" onClick={onSignUp}>
              Start capturing →
            </button>
            <a
              className="pill dark"
              href="#how"
              onClick={(e) => {
                e.preventDefault();
                rootRef.current
                  ?.querySelector('#how')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              See how it works
            </a>
            <span className="hand">free for your first notebook ↗</span>
          </div>
        </div>

        <div className="float f1" data-depth="22">
          <div className="float-inner">
            <div className="fcard butter">
              <small>NEXT REFERENCE</small>
              <span className="big">Q3-47</span>
              <span className="hand" style={{ fontSize: 15 }}>
                write me down
              </span>
            </div>
          </div>
        </div>
        <div className="float f2" data-depth="38">
          <div className="float-inner">
            <div className="fcard">
              <div className="head">
                <span className="ref">Q3-46</span>
                <span className="tag" style={{ background: 'var(--tag-pink)' }}>
                  BoardDeck
                </span>
              </div>
              <div className="shot">▦ covenant table, p.14</div>
            </div>
          </div>
        </div>
        <div className="float f3" data-depth="30">
          <div className="float-inner">
            <div className="fcard">
              <div className="head">
                <span className="ref">Q3-45</span>
                <span className="tag" style={{ background: 'var(--tag-teal)' }}>
                  CreditMemo
                </span>
              </div>
              <div className="fbody">
                Margins compressed 40bps QoQ — filings suggest pricing pressure.
              </div>
            </div>
          </div>
        </div>
        <div className="float f4" data-depth="16">
          <div className="float-inner">
            <div className="fcard">
              <div className="head">
                <span className="ref">Q3-44</span>
                <span className="tag" style={{ background: 'var(--tag-blue)' }}>
                  Q3Report
                </span>
              </div>
              <div
                className="fbody"
                dir="rtl"
                style={{ textAlign: 'right', fontFamily: 'Almarai' }}
              >
                النمو تجاوز التوقعات هذا الربع
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="marquee" aria-hidden="true">
        <div className="track">
          {MARQUEE}
          {MARQUEE}
        </div>
      </div>

      <section className="how" id="how">
        <h2 className="reveal">
          Three moves.
          <br />
          That's the whole app.
        </h2>
        <p className="sub reveal">Built for people who think on paper but live on screens.</p>
        <div className="steps">
          <div className="step reveal">
            <span className="n">01</span>
            <h3>Capture anything</h3>
            <p>
              Paste a screenshot, drop a file, type a thought. <b>Ctrl+V → Ctrl+Enter</b>, done.
              Links with <code>// url</code>, sticky sources with <code>@tag</code> — hands never
              leave the keyboard.
            </p>
          </div>
          <div className="step reveal">
            <span className="n">02</span>
            <h3>Write the number</h3>
            <p>
              The app shows your next reference <i>before</i> you even save — guaranteed, even
              offline. Write <b>Q3-47</b> in the margin of your notebook and keep moving.
            </p>
            <div className="demo">
              <div
                className="fcard butter"
                style={{ width: '100%', boxShadow: '3px 3px 0 var(--link)' }}
              >
                <small>NEXT REFERENCE</small>
                <span className="big" style={{ fontSize: 32 }}>
                  Q3-47
                </span>
              </div>
            </div>
          </div>
          <div className="step reveal">
            <span className="n">03</span>
            <h3>Type it back, years later</h3>
            <p>
              Flip open the notebook, type <b>Q3-47</b> — the screenshot appears. Numbers are never
              reused and never renumbered. A pointer written in ink stays true forever. That's the
              contract.
            </p>
          </div>
        </div>
      </section>

      <div className="vault reveal wrapn">
        <div className="vault-card">
          <span className="keys">🔑</span>
          <h2>
            Private like paper.
            <br />
            <span className="coral">Synced like software.</span>
          </h2>
          <p>
            Your insights are encrypted on your device before they ever leave it. Our servers store
            ciphertext — we couldn't read your research if we wanted to, and neither could anyone
            who broke in. One recovery key, held only by you.
          </p>
          <div className="badges">
            <span className="badge">AES-256 end-to-end</span>
            <span className="badge">Zero-knowledge sync</span>
            <span className="badge">Offline-first</span>
            <span className="badge">Export anytime</span>
          </div>
        </div>
      </div>

      <section className="final">
        <span className="hand reveal">your notebook deserves a search bar</span>
        <h2 className="reveal">
          Start your first
          <br />
          notebook today.
        </h2>
        <p className="reveal" style={{ margin: '22px 0 0' }}>
          <button
            type="button"
            className="pill coral"
            style={{ fontSize: 17, padding: '16px 34px' }}
            onClick={onSignUp}
          >
            Start capturing →
          </button>
        </p>
      </section>

      <footer>
        Insightyyy · a HAKAMI product ·{' '}
        <button type="button" onClick={onUseOffline}>
          use offline without an account
        </button>
      </footer>
    </div>
  );
}
