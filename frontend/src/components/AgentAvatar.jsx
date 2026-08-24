/** Vera — production cartoon avatar */

export default function AgentAvatar({ talking = false, listening = false }) {
  return (
    <div
      className={`vera-portrait ${talking ? 'talking' : ''} ${listening ? 'listening' : ''}`}
      aria-hidden
    >
      <svg viewBox="0 0 128 128" className="vera-svg" role="img" aria-label="Vera">
        <defs>
          <linearGradient id="veraBgG" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#FFFCF6" />
            <stop offset="100%" stopColor="#F3E4C4" />
          </linearGradient>
          <linearGradient id="veraSkinG" x1="0.35" y1="0.05" x2="0.65" y2="0.95">
            <stop offset="0%" stopColor="#FFE2CC" />
            <stop offset="45%" stopColor="#F2C4A4" />
            <stop offset="100%" stopColor="#D9A078" />
          </linearGradient>
          <linearGradient id="veraHairG" x1="0.3" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="#5C4A3A" />
            <stop offset="55%" stopColor="#3D2E24" />
            <stop offset="100%" stopColor="#2A2018" />
          </linearGradient>
          <linearGradient id="veraHairHi" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7A6554" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#7A6554" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="veraBlazerG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFD054" />
            <stop offset="100%" stopColor="#E8A010" />
          </linearGradient>
          <radialGradient id="veraCheekG" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E88878" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#E88878" stopOpacity="0" />
          </radialGradient>
          <filter id="veraDrop" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#1C1B18" floodOpacity="0.1" />
          </filter>
        </defs>

        <circle cx="64" cy="64" r="60" fill="url(#veraBgG)" />
        <circle cx="64" cy="64" r="60" fill="none" stroke="#F5B01A" strokeWidth="1.5" opacity="0.22" />

        {/* Shoulders / blazer */}
        <path
          d="M18 124c10-26 32-38 46-38s36 12 46 38H18z"
          fill="url(#veraBlazerG)"
          filter="url(#veraDrop)"
        />
        <path
          d="M44 112c10-10 20-14 20-14s10 4 20 14"
          stroke="#FFF6E4"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.45"
        />

        {/* Neck */}
        <rect x="54" y="78" width="20" height="16" rx="7" fill="#E0A878" />

        {/* Hair — pulled back, low bun (clean professional silhouette) */}
        <g className="vera-hair">
          {/* Back volume */}
          <path
            d="M34 54 C34 26 48 16 64 16 C80 16 94 26 94 54 C94 64 90 72 84 76 C78 70 72 68 64 68 C56 68 50 70 44 76 C38 72 34 64 34 54 Z"
            fill="url(#veraHairG)"
          />
          {/* Low bun */}
          <ellipse cx="78" cy="22" rx="11" ry="10" fill="url(#veraHairG)" />
          <ellipse cx="79" cy="21" rx="6" ry="5.5" fill="url(#veraHairHi)" />
          {/* Side tuck — smooth, no flappy strands */}
          <path
            d="M36 50 C38 38 48 30 64 30 C80 30 90 38 92 50 C90 44 82 40 64 40 C46 40 38 44 36 50 Z"
            fill="#3D2E24"
          />
          {/* Soft highlight on crown */}
          <path
            d="M48 28 Q64 22 76 28"
            stroke="#8A7260"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            opacity="0.35"
          />
        </g>

        {/* Face */}
        <g className="vera-face">
          <ellipse cx="64" cy="54" rx="30" ry="33" fill="url(#veraSkinG)" filter="url(#veraDrop)" />

          <ellipse cx="35" cy="56" rx="4.5" ry="6.5" fill="#D89868" />
          <ellipse cx="93" cy="56" rx="4.5" ry="6.5" fill="#D89868" />

          {/* Face-framing tendrils — minimal, symmetrical */}
          <path
            d="M38 52 C36 58 37 64 40 68"
            stroke="#3D2E24"
            strokeWidth="3.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M90 52 C92 58 91 64 88 68"
            stroke="#3D2E24"
            strokeWidth="3.5"
            fill="none"
            strokeLinecap="round"
          />

          {/* Headset */}
          <path
            d="M38 44 Q64 30 90 44"
            stroke="#3B6FB5"
            strokeWidth="3.5"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="36" cy="48" r="5.5" fill="#3B6FB5" />
          <circle cx="36" cy="48" r="3" fill="#5A8FD4" />
          <path
            d="M92 50 Q98 58 94 64"
            stroke="#3B6FB5"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse cx="93" cy="66" rx="4" ry="5" fill="#3B6FB5" />
          <ellipse cx="93" cy="66" rx="2" ry="2.5" fill="#1C1B18" opacity="0.35" />

          <path d="M46 46 Q52 42 58 44" stroke="#4A3828" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M70 44 Q76 42 82 46" stroke="#4A3828" strokeWidth="2.4" fill="none" strokeLinecap="round" />

          <g className="vera-eye vera-eye-l">
            <ellipse cx="50" cy="52" rx="7" ry="5.5" fill="#fff" />
            <circle cx="51" cy="53" r="3.2" fill="#2A2118" />
            <circle cx="52.4" cy="51.6" r="1.2" fill="#fff" />
            <ellipse className="vera-lid" cx="50" cy="52" rx="7.5" ry="6" fill="#EDAE86" />
          </g>
          <g className="vera-eye vera-eye-r">
            <ellipse cx="78" cy="52" rx="7" ry="5.5" fill="#fff" />
            <circle cx="79" cy="53" r="3.2" fill="#2A2118" />
            <circle cx="80.4" cy="51.6" r="1.2" fill="#fff" />
            <ellipse className="vera-lid" cx="78" cy="52" rx="7.5" ry="6" fill="#EDAE86" />
          </g>

          <ellipse cx="42" cy="60" rx="8" ry="5" fill="url(#veraCheekG)" />
          <ellipse cx="86" cy="60" rx="8" ry="5" fill="url(#veraCheekG)" />

          <path d="M64 56 L61 62 Q64 64 67 62 Z" fill="#C98862" opacity="0.42" />

          <g className="vera-mouth-wrap" transform="translate(64 70)">
            <path
              className="vera-lips"
              d="M-10 0 Q0 5 10 0"
              stroke="#B86058"
              strokeWidth="2.6"
              fill="none"
              strokeLinecap="round"
            />
            <ellipse className="vera-mouth-inner" cx="0" cy="2.5" rx="6" ry="3.5" fill="#9E4540" />
            <ellipse className="vera-mouth-inner vera-teeth" cx="0" cy="1.2" rx="4.5" ry="1.2" fill="#FFF8F2" opacity="0.85" />
          </g>
        </g>

        <path d="M50 88 Q64 96 78 88" stroke="#FFFAF0" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
      <div className="vera-shine" aria-hidden />
    </div>
  );
}
