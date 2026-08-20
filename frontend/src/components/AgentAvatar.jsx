/** Vera — polished cartoon avatar with lip-sync + blink */

export default function AgentAvatar({ talking = false, listening = false }) {
  return (
    <div
      className={`vera-portrait ${talking ? 'talking' : ''} ${listening ? 'listening' : ''}`}
      aria-hidden
    >
      <svg viewBox="0 0 120 120" className="vera-svg" role="img" aria-label="Vera">
        <defs>
          <linearGradient id="veraSkinG" x1="0.35" y1="0" x2="0.65" y2="1">
            <stop offset="0%" stopColor="#FFD4B8" />
            <stop offset="55%" stopColor="#F0B896" />
            <stop offset="100%" stopColor="#D9956E" />
          </linearGradient>
          <linearGradient id="veraHairG" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#4A3828" />
            <stop offset="100%" stopColor="#1E1610" />
          </linearGradient>
          <linearGradient id="veraTopG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFD56A" />
            <stop offset="100%" stopColor="#F5B01A" />
          </linearGradient>
          <radialGradient id="veraBlushL" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F5A090" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#F5A090" stopOpacity="0" />
          </radialGradient>
          <filter id="veraSoftShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#1C1B18" floodOpacity="0.12" />
          </filter>
        </defs>

        {/* Background circle */}
        <circle cx="60" cy="60" r="56" fill="#FFF9F0" />

        {/* Shoulders / amber top */}
        <path d="M14 118c8-22 28-34 46-34s38 12 46 34H14z" fill="url(#veraTopG)" filter="url(#veraSoftShadow)" />
        <path d="M38 108c8-8 18-12 22-12s14 4 22 12l-4 10H42l-4-10z" fill="#FFF5E0" opacity="0.35" />
        <ellipse cx="60" cy="98" rx="10" ry="4" fill="#E8A010" opacity="0.25" />

        {/* Neck */}
        <rect x="52" y="72" width="16" height="18" rx="6" fill="#E8A878" />

        {/* Hair back */}
        <ellipse cx="60" cy="48" rx="34" ry="36" fill="url(#veraHairG)" />

        {/* Face */}
        <ellipse cx="60" cy="52" rx="28" ry="31" fill="url(#veraSkinG)" filter="url(#veraSoftShadow)" />

        {/* Ears */}
        <ellipse cx="33" cy="54" rx="5" ry="7" fill="#E0A070" />
        <ellipse cx="87" cy="54" rx="5" ry="7" fill="#E0A070" />

        {/* Hair — side + bun */}
        <path
          d="M32 44c-2-14 10-26 28-26s30 12 28 26c-4-10-12-16-28-16S36 34 32 44z"
          fill="url(#veraHairG)"
        />
        <circle cx="78" cy="28" r="11" fill="url(#veraHairG)" />
        <circle cx="78" cy="28" r="7" fill="#3D2E22" opacity="0.2" />

        {/* Brows */}
        <path d="M44 44 Q50 40 56 42" stroke="#5C4030" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M64 42 Q70 40 76 44" stroke="#5C4030" strokeWidth="2.2" fill="none" strokeLinecap="round" />

        {/* Eyes */}
        <g className="vera-eye vera-eye-l">
          <ellipse cx="48" cy="50" rx="6.5" ry="5" fill="#fff" />
          <circle cx="49" cy="51" r="3" fill="#2A2118" />
          <circle cx="50.2" cy="49.8" r="1.1" fill="#fff" />
          <ellipse className="vera-lid" cx="48" cy="50" rx="7" ry="5.5" fill="#EDAE86" />
        </g>
        <g className="vera-eye vera-eye-r">
          <ellipse cx="72" cy="50" rx="6.5" ry="5" fill="#fff" />
          <circle cx="73" cy="51" r="3" fill="#2A2118" />
          <circle cx="74.2" cy="49.8" r="1.1" fill="#fff" />
          <ellipse className="vera-lid" cx="72" cy="50" rx="7" ry="5.5" fill="#EDAE86" />
        </g>

        {/* Cheeks */}
        <ellipse cx="40" cy="58" rx="7" ry="4.5" fill="url(#veraBlushL)" />
        <ellipse cx="80" cy="58" rx="7" ry="4.5" fill="url(#veraBlushL)" />

        {/* Nose */}
        <path
          d="M60 54 L57 60 Q60 62 63 60 Z"
          fill="#C98862"
          opacity="0.5"
        />

        {/* Mouth — animates when talking */}
        <g className="vera-mouth-group" transform="translate(60 66)">
          <ellipse className="vera-mouth vera-mouth-closed" cx="0" cy="0" rx="8" ry="3" fill="#C46B62" />
          <ellipse className="vera-mouth vera-mouth-open" cx="0" cy="1" rx="7" ry="5.5" fill="#A84840" />
          <ellipse className="vera-mouth vera-mouth-open vera-tongue" cx="0" cy="3" rx="4" ry="2.5" fill="#D47870" opacity="0.7" />
        </g>

        {/* Collar detail */}
        <path d="M48 84 Q60 90 72 84" stroke="#FFF8EE" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7" />
      </svg>
      {talking ? (
        <div className="vera-speech-indicator" aria-hidden>
          <span /><span /><span /><span /><span />
        </div>
      ) : null}
    </div>
  );
}
