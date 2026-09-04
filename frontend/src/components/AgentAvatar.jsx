import { useEffect, useId, useRef } from 'react';

/** Exact Vera face from datanitiv-planning-agent_voice_09_03_2026_latest.html */
const VIS = {
  A: [9, 6.4, 7.6],
  E: [11, 3.4, 6.6],
  I: [10, 2.8, 5.6],
  O: [7, 6.6, 4.4],
  U: [5.4, 5.4, 3.4],
  M: [8.6, 1.1, 0],
};

function setViseme(mouth, lips, teeth, v, amp = 1) {
  if (!mouth) return;
  const k = VIS[v] || VIS.M;
  mouth.setAttribute('rx', (k[0] * amp + 2).toFixed(1));
  mouth.setAttribute('ry', Math.max(0.8, k[1] * amp).toFixed(1));
  if (lips) lips.setAttribute('ry', (4.4 + k[1] * amp * 0.42).toFixed(1));
  if (teeth) teeth.setAttribute('ry', (k[2] * amp * 0.42).toFixed(1));
}

export default function AgentAvatar({ talking = false, listening = false }) {
  const uid = useId().replace(/:/g, '');
  const rootRef = useRef(null);
  const talkingRef = useRef(talking);
  talkingRef.current = talking;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const headG = root.querySelector('[data-vera="head"]');
    const pupL = root.querySelector('[data-vera="pupL"]');
    const pupR = root.querySelector('[data-vera="pupR"]');
    const lidL = root.querySelector('[data-vera="lidL"]');
    const lidR = root.querySelector('[data-vera="lidR"]');
    const mouth = root.querySelector('[data-vera="mouth"]');
    const lips = root.querySelector('[data-vera="lips"]');
    const teeth = root.querySelector('[data-vera="teeth"]');
    const browL = root.querySelector('[data-vera="browL"]');
    const browR = root.querySelector('[data-vera="browR"]');

    let hT = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const lookAt = (x, y) => {
      [pupL, pupR].forEach((el) => {
        if (el) el.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      });
    };

    const browRaise = (v) => {
      [browL, browR].forEach((el) => {
        if (el) el.setAttribute('transform', `translate(0,${(-v).toFixed(1)})`);
      });
    };

    const blink = () => {
      if (reduce) return;
      [lidL, lidR].forEach((el) => {
        if (el) el.style.transform = 'scaleY(1)';
      });
      setTimeout(() => {
        [lidL, lidR].forEach((el) => {
          if (el) el.style.transform = 'scaleY(0)';
        });
      }, 110);
    };

    // Idle lids closed (open eyes)
    [lidL, lidR].forEach((el) => {
      if (el) {
        el.style.transformOrigin = 'center';
        el.style.transform = 'scaleY(0)';
        el.style.transition = 'transform .08s ease';
      }
    });
    setViseme(mouth, lips, teeth, 'M', 1);

    const headTimer = setInterval(() => {
      if (reduce || !headG) return;
      hT += 0.045;
      const sw = Math.sin(hT) * 1.5;
      const bo = Math.cos(hT * 0.7) * 1.0;
      const nd = talkingRef.current ? Math.sin(hT * 3.1) * 0.9 : 0;
      headG.setAttribute('transform', `translate(${sw.toFixed(2)},${(bo + nd).toFixed(2)})`);
    }, 40);

    const lookTimer = setInterval(() => {
      if (reduce || talkingRef.current) return;
      lookAt(Math.random() * 3.2 - 1.6, Math.random() * 1.8 - 0.9);
    }, 2100);

    let blinkTimeout;
    const scheduleBlink = () => {
      blinkTimeout = setTimeout(() => {
        if (!talkingRef.current) blink();
        scheduleBlink();
      }, 2600 + Math.random() * 3400);
    };
    if (!reduce) scheduleBlink();

    let lipTimer;
    if (talking) {
      browRaise(0.6);
      lookAt(0, 0);
      const keys = ['A', 'E', 'O', 'I', 'U'];
      lipTimer = setInterval(() => {
        const v = keys[Math.floor(Math.random() * keys.length)];
        setViseme(mouth, lips, teeth, v, 0.45 + Math.random() * 0.5);
      }, 105);
    } else {
      browRaise(0);
      setViseme(mouth, lips, teeth, 'M', 1);
    }

    return () => {
      clearInterval(headTimer);
      clearInterval(lookTimer);
      clearTimeout(blinkTimeout);
      if (lipTimer) clearInterval(lipTimer);
    };
  }, [talking, uid]);

  const id = (name) => `${uid}-${name}`;

  return (
    <div
      ref={rootRef}
      className={`face vera-face-wrap ${talking ? 'talking' : ''} ${listening ? 'listening' : ''}`}
      aria-hidden
    >
      <svg viewBox="0 0 200 200" className="vera-svg" role="img" aria-label="Vera">
        <defs>
          <linearGradient id={id('skin')} x1="0.3" y1="0" x2="0.7" y2="1">
            <stop offset="0" stopColor="#F6D3B4" />
            <stop offset="0.55" stopColor="#EDBE98" />
            <stop offset="1" stopColor="#D9A47C" />
          </linearGradient>
          <linearGradient id={id('skinShade')} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#B98763" stopOpacity=".38" />
            <stop offset="0.45" stopColor="#B98763" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={id('hairG')} x1="0.2" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#4A3A28" />
            <stop offset="0.5" stopColor="#33281B" />
            <stop offset="1" stopColor="#241C13" />
          </linearGradient>
          <linearGradient id={id('collarG')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F7BC3C" />
            <stop offset="1" stopColor="#D89407" />
          </linearGradient>
          <radialGradient id={id('cheekG')} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#E08A72" stopOpacity=".34" />
            <stop offset="1" stopColor="#E08A72" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id('bgG')} cx="0.5" cy="0.38" r="0.72">
            <stop offset="0" stopColor="#FEF7E7" />
            <stop offset="1" stopColor="#F3E6C6" />
          </radialGradient>
          <clipPath id={id('ecL')}>
            <ellipse cx="76" cy="98" rx="12.5" ry="8.4" />
          </clipPath>
          <clipPath id={id('ecR')}>
            <ellipse cx="124" cy="98" rx="12.5" ry="8.4" />
          </clipPath>
        </defs>

        <rect width="200" height="200" fill={`url(#${id('bgG')})`} />
        <path d="M20 200c0-30 26-46 80-46s80 16 80 46z" fill={`url(#${id('collarG')})`} />
        <path
          d="M74 158c8 12 18 18 26 18s18-6 26-18c-9-5-17-7-26-7s-17 2-26 7z"
          fill="#FFFDF6"
          opacity=".92"
        />
        <path d="M84 130h32v26c0 9-7 14-16 14s-16-5-16-14z" fill="#DCA57C" />
        <path d="M84 130h32v13c-6 6-12 8-16 8s-10-2-16-8z" fill="#C08B65" opacity=".55" />
        <path
          d="M44 96c-3-40 22-64 56-64s59 24 56 64c-2 22-7 30-10 33 2-16 1-30-2-40-6 8-14 12-24 12-18 0-38-6-48-16-4 12-6 28-4 44-4-4-9-11-11-33z"
          fill={`url(#${id('hairG')})`}
        />

        <g data-vera="head">
          <ellipse cx="100" cy="98" rx="46" ry="54" fill={`url(#${id('skin')})`} />
          <ellipse cx="100" cy="98" rx="46" ry="54" fill={`url(#${id('skinShade')})`} />
          <ellipse cx="55" cy="102" rx="7" ry="11" fill="#E5B48E" />
          <ellipse cx="145" cy="102" rx="7" ry="11" fill="#E5B48E" />
          <ellipse cx="70" cy="115" rx="15" ry="11" fill={`url(#${id('cheekG')})`} />
          <ellipse cx="130" cy="115" rx="15" ry="11" fill={`url(#${id('cheekG')})`} />

          <g data-vera="browL">
            <path
              d="M63 82c6-5 17-6 24-2"
              stroke="#3A2C1C"
              strokeWidth="4.2"
              fill="none"
              strokeLinecap="round"
            />
          </g>
          <g data-vera="browR">
            <path
              d="M113 80c7-4 18-3 24 2"
              stroke="#3A2C1C"
              strokeWidth="4.2"
              fill="none"
              strokeLinecap="round"
            />
          </g>

          <g>
            <ellipse cx="76" cy="98" rx="12.5" ry="8.4" fill="#FCFCFD" />
            <ellipse cx="124" cy="98" rx="12.5" ry="8.4" fill="#FCFCFD" />
            <g clipPath={`url(#${id('ecL')})`}>
              <g data-vera="pupL">
                <circle cx="76" cy="98" r="6.2" fill="#5C4327" />
                <circle cx="76" cy="98" r="3.1" fill="#1C1B18" />
                <circle cx="73.6" cy="95.4" r="1.9" fill="#fff" opacity=".92" />
              </g>
            </g>
            <g clipPath={`url(#${id('ecR')})`}>
              <g data-vera="pupR">
                <circle cx="124" cy="98" r="6.2" fill="#5C4327" />
                <circle cx="124" cy="98" r="3.1" fill="#1C1B18" />
                <circle cx="121.6" cy="95.4" r="1.9" fill="#fff" opacity=".92" />
              </g>
            </g>
            <path
              d="M63.5 98a12.5 8.4 0 0 1 25 0"
              fill="none"
              stroke="#5A4634"
              strokeWidth="1.5"
              opacity=".5"
            />
            <path
              d="M111.5 98a12.5 8.4 0 0 1 25 0"
              fill="none"
              stroke="#5A4634"
              strokeWidth="1.5"
              opacity=".5"
            />
            <ellipse
              className="lid"
              data-vera="lidL"
              cx="76"
              cy="98"
              rx="13"
              ry="8.8"
              fill="#EDBE98"
            />
            <ellipse
              className="lid"
              data-vera="lidR"
              cx="124"
              cy="98"
              rx="13"
              ry="8.8"
              fill="#EDBE98"
            />
          </g>

          <path
            d="M100 100v14c0 3.4-2.8 5-6 5"
            stroke="#C08B65"
            strokeWidth="2.6"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse cx="94" cy="120" rx="2.2" ry="1.5" fill="#B87F5C" opacity=".55" />
          <ellipse cx="106" cy="120" rx="2.2" ry="1.5" fill="#B87F5C" opacity=".55" />

          <g>
            <ellipse data-vera="lips" cx="100" cy="134" rx="13" ry="4.4" fill="#C4756B" />
            <ellipse data-vera="mouth" cx="100" cy="134.5" rx="9" ry="1.6" fill="#7E3B3C" />
            <ellipse data-vera="teeth" cx="100" cy="132.6" rx="7.4" ry="0" fill="#FDFDFD" />
          </g>

          <path
            d="M54 92c-2-36 20-58 46-58s48 22 46 58c-4-18-10-27-16-25-10 4-30 8-46-2-8-5-14 5-16 16-2 8-13 22-14 11z"
            fill={`url(#${id('hairG')})`}
          />
          <path
            d="M120 42c14 8 22 26 21 46-3-14-9-24-15-26 3-7 1-14-6-20z"
            fill="#6A5236"
            opacity=".5"
          />
        </g>
      </svg>
    </div>
  );
}
