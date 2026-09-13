/**
 * Drawings for the front page. Each one shows a real part of Faregate in the
 * console's own palette (paper, ink, stamp blue and the three verdict
 * colours), so a first-time visitor sees what the product does before reading
 * about it. Plain SVG: sharp at any size, and nothing extra to download.
 */

const D = 'font-display font-semibold';
const S = 'font-sans';
const M = 'font-mono';

/** The console in use: a request waiting for approval, a settled fare, the passport and the agent. */
export function HeroCollage() {
  return (
    <svg
      viewBox="-16 -14 672 530"
      className="h-auto w-full"
      role="img"
      aria-label="The Faregate console: a $0.036 request waiting for approval, a settled USDC payment on Hedera, the agent’s ENS passport with its limits, and the agent’s terminal."
    >
      <defs>
        <filter id="fg-hero-soft" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="6" stdDeviation="9" floodColor="#1C1B18" floodOpacity="0.1" />
        </filter>
        <filter id="fg-hero-lift" x="-20%" y="-25%" width="140%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="13" floodColor="#1C1B18" floodOpacity="0.18" />
        </filter>
        <pattern id="fg-hero-dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.1" fill="#BFB7A5" />
        </pattern>
      </defs>
      <rect x="44" y="58" width="596" height="440" rx="10" fill="url(#fg-hero-dots)" opacity="0.75" />

      {/* The console window */}
      <g filter="url(#fg-hero-soft)">
        <rect x="0" y="30" width="440" height="362" rx="6" fill="#FBFAF6" stroke="#DDD7CA" />
      </g>
      <line x1="0" y1="64" x2="440" y2="64" stroke="#DDD7CA" />
      <rect x="16" y="39" width="3" height="16" fill="#1C1B18" />
      <rect x="29" y="39" width="3" height="16" fill="#1C1B18" />
      <rect x="19" y="45.5" width="10" height="3" fill="#2446A6" />
      <text className={D} x="40" y="52" fontSize="15" fill="#1C1B18">
        Faregate
      </text>
      <text className={S} x="116" y="51" fontSize="11" fontWeight="500" fill="#1C1B18">
        Requests
      </text>
      <text className={S} x="178" y="51" fontSize="11" fill="#4A463E">
        Passports
      </text>
      <text className={S} x="242" y="51" fontSize="11" fill="#4A463E">
        Ledger
      </text>
      <rect x="116" y="62" width="47" height="2" fill="#1C1B18" />
      <text className={D} x="20" y="96" fontSize="21" fill="#1C1B18">
        Requests
      </text>
      <g className={D} fontSize="9" letterSpacing="0.8" fill="#787164">
        <text x="20" y="122">NEEDS YOU</text>
        <text x="108" y="122">SPENT TODAY</text>
        <text x="226" y="122">SETTLED</text>
        <text x="302" y="122">REFUSED</text>
      </g>
      <g className={M} fontSize="17" fontWeight="500">
        <text x="20" y="145" fill="#95570A">1</text>
        <text x="108" y="145" fill="#1C1B18">$0.0462</text>
        <text x="226" y="145" fill="#1C1B18">2</text>
        <text x="302" y="145" fill="#1C1B18">1</text>
      </g>
      <g stroke="#DDD7CA">
        <line x1="94" y1="112" x2="94" y2="150" />
        <line x1="212" y1="112" x2="212" y2="150" />
        <line x1="288" y1="112" x2="288" y2="150" />
      </g>
      <line x1="20" y1="164" x2="420" y2="164" stroke="#1C1B18" strokeWidth="1.5" />
      <text className={D} x="20" y="186" fontSize="12.5" fill="#1C1B18">
        All requests
      </text>
      <line x1="20" y1="194" x2="420" y2="194" stroke="#DDD7CA" />

      <g className={M} fontSize="10" fill="#787164">
        <text x="20" y="222">10:31</text>
        <text x="20" y="268">10:24</text>
        <text x="20" y="314">10:22</text>
        <text x="20" y="360">10:19</text>
      </g>
      <g className={S} fontSize="11" fontWeight="500" fill="#1C1B18">
        <text x="60" y="214">Treasury Research</text>
        <text x="60" y="260">Trial Scout</text>
        <text x="60" y="306">Treasury Research</text>
        <text x="60" y="352">Treasury Research</text>
      </g>
      <g className={S} fontSize="10" fill="#787164">
        <text x="60" y="228">30 days of activity</text>
        <text x="60" y="274">30 days of activity</text>
        <text x="60" y="320">Today’s balances</text>
        <text x="60" y="366">30 days of activity</text>
      </g>
      <g className={M} fontSize="10.5" fill="#1C1B18">
        <text x="276" y="222">$0.0360</text>
        <text x="276" y="268" fill="#787164">
          none
        </text>
        <text x="276" y="314">$0.0102</text>
        <text x="276" y="360">$0.0360</text>
      </g>
      <g stroke="#DDD7CA">
        <line x1="20" y1="240" x2="420" y2="240" />
        <line x1="20" y1="286" x2="420" y2="286" />
        <line x1="20" y1="332" x2="420" y2="332" />
      </g>

      {/* Each row's route, the console's gate track in miniature */}
      <line x1="190" y1="218" x2="222" y2="218" stroke="#1C1B18" strokeWidth="1.5" />
      <line x1="222" y1="218" x2="254" y2="218" stroke="#DDD7CA" strokeWidth="1.5" />
      <circle cx="190" cy="218" r="4" fill="#1C1B18" />
      <circle cx="206" cy="218" r="4" fill="#1C1B18" />
      <circle cx="222" cy="218" r="4.5" fill="#F5E9D0" stroke="#95570A" strokeWidth="1.8" />
      <circle cx="238" cy="218" r="3" fill="#FBFAF6" stroke="#BFB7A5" />
      <circle cx="254" cy="218" r="3" fill="#FBFAF6" stroke="#BFB7A5" />

      <line x1="190" y1="264" x2="206" y2="264" stroke="#B0261E" strokeWidth="1.5" />
      <line x1="206" y1="264" x2="254" y2="264" stroke="#DDD7CA" strokeWidth="1.5" />
      <circle cx="190" cy="264" r="4" fill="#1C1B18" />
      <rect x="202.5" y="260.5" width="7" height="7" fill="#B0261E" />
      <circle cx="222" cy="264" r="3" fill="#FBFAF6" stroke="#BFB7A5" />
      <circle cx="238" cy="264" r="3" fill="#FBFAF6" stroke="#BFB7A5" />
      <circle cx="254" cy="264" r="3" fill="#FBFAF6" stroke="#BFB7A5" />

      <line x1="190" y1="310" x2="254" y2="310" stroke="#1C1B18" strokeWidth="1.5" />
      <circle cx="190" cy="310" r="4" fill="#1C1B18" />
      <circle cx="206" cy="310" r="4" fill="#1C1B18" />
      <circle cx="222" cy="310" r="3.5" fill="#FBFAF6" stroke="#1C1B18" strokeWidth="1.5" />
      <circle cx="238" cy="310" r="4" fill="#1C1B18" />
      <circle cx="254" cy="310" r="4" fill="#1C1B18" />

      <line x1="190" y1="356" x2="254" y2="356" stroke="#1C1B18" strokeWidth="1.5" />
      <circle cx="190" cy="356" r="4" fill="#1C1B18" />
      <circle cx="206" cy="356" r="4" fill="#1C1B18" />
      <circle cx="222" cy="356" r="4" fill="#1C1B18" />
      <circle cx="238" cy="356" r="4" fill="#1C1B18" />
      <circle cx="254" cy="356" r="4" fill="#1C1B18" />

      <rect x="344" y="209" width="76" height="17" rx="2" fill="#F5E9D0" stroke="#95570A" strokeOpacity="0.45" />
      <rect x="344" y="255" width="76" height="17" rx="2" fill="#F6E1DD" stroke="#B0261E" strokeOpacity="0.45" />
      <rect x="344" y="301" width="76" height="17" rx="2" fill="#E0EEE5" stroke="#1E6A44" strokeOpacity="0.45" />
      <rect x="344" y="347" width="76" height="17" rx="2" fill="#E0EEE5" stroke="#1E6A44" strokeOpacity="0.45" />
      <g className={D} fontSize="9.5" letterSpacing="0.8" textAnchor="middle">
        <text x="382" y="221.5" fill="#95570A">NEEDS YOU</text>
        <text x="382" y="267.5" fill="#B0261E">REFUSED</text>
        <text x="382" y="313.5" fill="#1E6A44">DELIVERED</text>
        <text x="382" y="359.5" fill="#1E6A44">DELIVERED</text>
      </g>

      {/* A settled fare */}
      <g filter="url(#fg-hero-lift)">
        <rect x="372" y="0" width="254" height="76" rx="6" fill="#FBFAF6" stroke="#DDD7CA" />
      </g>
      <circle cx="400" cy="38" r="14" fill="#1E6A44" />
      <path
        d="M393.5 38.5 L398 43 L406.5 33.5"
        fill="none"
        stroke="#FBFAF6"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text className={D} x="424" y="28" fontSize="9.5" letterSpacing="0.8" fill="#787164">
        FARE SETTLED · HEDERA
      </text>
      <text className={M} x="424" y="48" fontSize="15" fontWeight="500" fill="#1C1B18">
        $0.0360 USDC
      </text>
      <text className={M} x="424" y="64" fontSize="9.5" fill="#787164">
        0.0.7162784@1789294894
      </text>

      {/* The agent's passport */}
      <g filter="url(#fg-hero-lift)">
        <rect x="454" y="110" width="180" height="190" rx="8" fill="#2446A6" />
      </g>
      <circle cx="480" cy="138" r="13" fill="none" stroke="#FBFAF6" strokeWidth="1.5" />
      <rect x="473" y="130" width="2.6" height="16" fill="#FBFAF6" />
      <rect x="484.4" y="130" width="2.6" height="16" fill="#FBFAF6" />
      <rect x="475.6" y="136.7" width="8.8" height="2.6" fill="#FBFAF6" />
      <text className={D} x="502" y="136" fontSize="11" letterSpacing="1.4" fill="#FBFAF6">
        PASSPORT
      </text>
      <text className={M} x="502" y="150" fontSize="9.5" fill="#C9D3EE">
        ENS · Sepolia
      </text>
      <text className={M} x="470" y="180" fontSize="11" fill="#FBFAF6">
        research.agents
      </text>
      <text className={M} x="470" y="195" fontSize="11" fill="#FBFAF6">
        .faregate.eth
      </text>
      <line x1="470" y1="207" x2="618" y2="207" stroke="#FBFAF6" strokeOpacity="0.25" />
      <g className={D} fontSize="9.5" letterSpacing="0.8" fill="#C9D3EE">
        <text x="470" y="228">PER QUERY</text>
        <text x="470" y="248">APPROVE ABOVE</text>
        <text x="470" y="268">DAILY LIMIT</text>
      </g>
      <g className={M} fontSize="11.5" fontWeight="500" fill="#FBFAF6" textAnchor="end">
        <text x="618" y="228">$0.10</text>
        <text x="618" y="248">$0.02</text>
        <text x="618" y="268">$1.00</text>
      </g>
      <g transform="rotate(-6 501 287)">
        <rect x="470" y="278" width="62" height="17" rx="2" fill="none" stroke="#A8D5B9" strokeWidth="1.6" />
        <text className={D} x="501" y="290.5" fontSize="9.5" letterSpacing="1" textAnchor="middle" fill="#A8D5B9">
          ACTIVE
        </text>
      </g>

      {/* The agent, in its terminal */}
      <g filter="url(#fg-hero-lift)">
        <rect x="14" y="384" width="222" height="112" rx="6" fill="#1C1B18" />
      </g>
      <text className={M} x="28" y="403" fontSize="9.5" fill="#8D8677">
        agent · terminal
      </text>
      <line x1="14" y1="411" x2="236" y2="411" stroke="#3A3832" />
      <g className={M} fontSize="10.5">
        <text x="28" y="430" fill="#FBFAF6">
          <tspan fill="#8FA6E6">$</tspan> npm run agent
        </text>
        <text x="28" y="447" fill="#8D8677">
          price
          <tspan x="92" fill="#D9D3C4">
            $0.036
          </tspan>
        </text>
        <text x="28" y="464" fill="#A8D5B9">
          ✓ approved by a human
        </text>
        <text x="28" y="481" fill="#A8D5B9">
          ✓ data released
        </text>
      </g>

      {/* The approval, in front */}
      <g filter="url(#fg-hero-lift)">
        <rect x="196" y="330" width="436" height="140" rx="6" fill="#FBFAF6" stroke="#BFB7A5" />
      </g>
      <rect x="196" y="336" width="4" height="128" fill="#95570A" />
      <text className={S} x="216" y="356" fontSize="12" fontWeight="500" fill="#1C1B18">
        Treasury Research Agent
      </text>
      <text className={M} x="216" y="371" fontSize="9.5" fill="#787164">
        research.agents.faregate.eth
      </text>
      <text className={S} x="216" y="400" fontSize="16" fill="#1C1B18">
        Wants 30 days of wallet activity
      </text>
      <line x1="216" y1="416" x2="470" y2="416" stroke="#DDD7CA" strokeDasharray="3 3" />
      <text className={S} x="216" y="440" fontSize="11.5" fill="#4A463E">
        Costs $0.036, above the $0.02 line
      </text>
      <line x1="490" y1="342" x2="490" y2="458" stroke="#BFB7A5" strokeDasharray="4 3" />
      <text className={D} x="506" y="357" fontSize="9.5" letterSpacing="0.8" fill="#787164">
        FARE
      </text>
      <text className={M} x="506" y="385" fontSize="23" fontWeight="500" fill="#1C1B18">
        $0.036
      </text>
      <rect x="506" y="402" width="66" height="28" rx="3" fill="#1E6A44" />
      <text className={S} x="539" y="420" fontSize="11.5" fontWeight="500" textAnchor="middle" fill="#FFFFFF">
        Approve
      </text>
      <rect x="578" y="402" width="44" height="28" rx="3" fill="#FBFAF6" stroke="#B0261E" strokeOpacity="0.6" />
      <text className={S} x="600" y="420" fontSize="11.5" fontWeight="500" textAnchor="middle" fill="#B0261E">
        Reject
      </text>
      <text className={M} x="506" y="452" fontSize="9" fill="#787164">
        signs, spends nothing
      </text>
      <path
        d="M552 414 V431 L556.6 426.8 L559.8 434 L562.8 432.7 L559.7 425.6 H565.6 Z"
        fill="#1C1B18"
        stroke="#FBFAF6"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Today: an agent holds a key and a card with no limit on it. */
export function OpenCardArt() {
  return (
    <svg viewBox="0 0 360 210" className="h-auto w-full" role="img" aria-label="An agent API key and card with no limit and no expiry">
      <defs>
        <filter id="fg-card-shadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#1C1B18" floodOpacity="0.22" />
        </filter>
      </defs>
      <g transform="rotate(-7 180 110)">
        <g filter="url(#fg-card-shadow)">
          <rect x="64" y="42" width="232" height="140" rx="12" fill="#1C1B18" />
        </g>
        <rect x="88" y="70" width="36" height="27" rx="4" fill="#BFB7A5" />
        <line x1="88" y1="83.5" x2="124" y2="83.5" stroke="#8D8677" />
        <line x1="106" y1="70" x2="106" y2="97" stroke="#8D8677" />
        <text className={M} x="88" y="134" fontSize="14.5" letterSpacing="1" fill="#FBFAF6">
          •••• •••• •••• 4021
        </text>
        <text className={D} x="88" y="163" fontSize="10.5" letterSpacing="1.2" fill="#8D8677">
          AGENT API KEY
        </text>
        <text className={D} x="272" y="163" fontSize="10.5" letterSpacing="1.2" textAnchor="end" fill="#8D8677">
          NO EXPIRY
        </text>
      </g>
      <g transform="rotate(9 262 60)">
        <rect x="200" y="40" width="124" height="40" rx="3" fill="#F6E1DD" stroke="#B0261E" strokeWidth="3" />
        <text className={D} x="262" y="68" fontSize="20" letterSpacing="2.4" textAnchor="middle" fill="#B0261E">
          NO LIMIT
        </text>
      </g>
    </svg>
  );
}

/** With Faregate: an ENS passport whose limits the gate reads, stamped active. */
export function PassportArt() {
  return (
    <svg viewBox="0 0 360 210" className="h-auto w-full" role="img" aria-label="An ENS passport with its limits, stamped active">
      <defs>
        <filter id="fg-passport-shadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#1C1B18" floodOpacity="0.18" />
        </filter>
      </defs>
      <g filter="url(#fg-passport-shadow)">
        <rect x="36" y="30" width="118" height="164" rx="8" fill="#2446A6" />
      </g>
      <circle cx="95" cy="88" r="24" fill="none" stroke="#FBFAF6" strokeWidth="1.8" />
      <rect x="83" y="73" width="4.5" height="30" fill="#FBFAF6" />
      <rect x="102.5" y="73" width="4.5" height="30" fill="#FBFAF6" />
      <rect x="87.5" y="85.75" width="15" height="4.5" fill="#FBFAF6" />
      <text className={D} x="95" y="142" fontSize="13" letterSpacing="1.8" textAnchor="middle" fill="#FBFAF6">
        PASSPORT
      </text>
      <text className={D} x="95" y="160" fontSize="10" letterSpacing="1" textAnchor="middle" fill="#C9D3EE">
        ENS
      </text>
      <g filter="url(#fg-passport-shadow)">
        <rect x="138" y="54" width="194" height="132" rx="6" fill="#FBFAF6" stroke="#BFB7A5" />
      </g>
      <text className={M} x="152" y="80" fontSize="10.5" fill="#1C1B18">
        research.agents.faregate.eth
      </text>
      <line x1="152" y1="92" x2="318" y2="92" stroke="#DDD7CA" />
      <g className={D} fontSize="10" letterSpacing="0.9" fill="#787164">
        <text x="152" y="116">PER QUERY</text>
        <text x="152" y="140">APPROVE ABOVE</text>
        <text x="152" y="164">DAILY LIMIT</text>
      </g>
      <g className={M} fontSize="13" fontWeight="500" textAnchor="end" fill="#1C1B18">
        <text x="318" y="116">$0.10</text>
        <text x="318" y="140">$0.02</text>
        <text x="318" y="164">$1.00</text>
      </g>
      <g transform="rotate(-8 290 44)">
        <rect x="248" y="28" width="84" height="32" rx="3" fill="#E0EEE5" stroke="#1E6A44" strokeWidth="3" />
        <text className={D} x="290" y="50.5" fontSize="17" letterSpacing="2" textAnchor="middle" fill="#1E6A44">
          ACTIVE
        </text>
      </g>
    </svg>
  );
}

function Disc({ id, tint, children }: { id: string; tint: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 160 160" className="h-[144px] w-[144px]" aria-hidden>
      <defs>
        <clipPath id={id}>
          <circle cx="80" cy="80" r="76" />
        </clipPath>
      </defs>
      <circle cx="80" cy="80" r="76" fill={tint} stroke="#1C1B18" strokeWidth="2" />
      <g clipPath={`url(#${id})`}>{children}</g>
    </svg>
  );
}

/** Stop 1: the agent asks in plain English. */
export function AskedArt() {
  return (
    <Disc id="fg-stop-asked" tint="#ECE8DD">
      <rect x="30" y="50" width="100" height="64" rx="5" fill="#1C1B18" />
      <text className={M} x="42" y="74" fontSize="11" fill="#FBFAF6">
        {'> balance'}
      </text>
      <text className={M} x="52" y="90" fontSize="11" fill="#D9D3C4">
        today?
      </text>
      <rect x="42" y="97" width="7" height="11" fill="#8FA6E6" />
      <path d="M18 114 H142 L134 126 H26 Z" fill="#4A463E" />
      <rect x="96" y="22" width="50" height="28" rx="8" fill="#FBFAF6" stroke="#1C1B18" strokeWidth="1.5" />
      <path d="M103 48 L101 59 L114 48" fill="#FBFAF6" stroke="#1C1B18" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="110" cy="36" r="3" fill="#2446A6" />
      <circle cx="121" cy="36" r="3" fill="#2446A6" />
      <circle cx="132" cy="36" r="3" fill="#2446A6" />
    </Disc>
  );
}

/** Stop 2: the gate reads the passport's limits from ENS. */
export function PassportCheckArt() {
  return (
    <Disc id="fg-stop-passport" tint="#E3E8F5">
      <rect x="44" y="30" width="66" height="94" rx="5" fill="#2446A6" />
      <circle cx="77" cy="64" r="15" fill="none" stroke="#FBFAF6" strokeWidth="1.6" />
      <rect x="69.5" y="55" width="3" height="18" fill="#FBFAF6" />
      <rect x="81.5" y="55" width="3" height="18" fill="#FBFAF6" />
      <rect x="72.5" y="62.5" width="9" height="3" fill="#FBFAF6" />
      <text className={D} x="77" y="101" fontSize="9.5" letterSpacing="1.1" textAnchor="middle" fill="#FBFAF6">
        PASSPORT
      </text>
      <circle cx="106" cy="104" r="19" fill="#FBFAF6" fillOpacity="0.55" stroke="#1C1B18" strokeWidth="4" />
      <line x1="120" y1="118" x2="136" y2="134" stroke="#1C1B18" strokeWidth="7" strokeLinecap="round" />
    </Disc>
  );
}

/** Stop 3: a person approves a bigger request with a signature. */
export function ApproveArt() {
  return (
    <Disc id="fg-stop-you" tint="#F5E9D0">
      <path d="M28 164 C28 124 48 106 74 106 C100 106 120 124 120 164 Z" fill="#2446A6" />
      <rect x="66" y="82" width="16" height="26" rx="6" fill="#B98A62" />
      <circle cx="74" cy="62" r="20" fill="#B98A62" />
      <path d="M54 63 A20 20 0 0 1 94 60 Q84 50 70 53 Q60 55 54 63 Z" fill="#1C1B18" />
      <rect x="98" y="84" width="34" height="56" rx="6" fill="#1C1B18" />
      <rect x="102" y="90" width="26" height="42" rx="2" fill="#FBFAF6" />
      <circle cx="115" cy="106" r="9" fill="#1E6A44" />
      <path
        d="M110.5 106.3 L113.8 109.4 L119.5 102.8"
        fill="none"
        stroke="#FBFAF6"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="105" y="121" width="20" height="5" rx="2" fill="#1E6A44" />
      <path d="M100 152 C98 140 99 132 104 127" fill="none" stroke="#2446A6" strokeWidth="12" strokeLinecap="round" />
      <circle cx="103" cy="127" r="7" fill="#B98A62" />
    </Disc>
  );
}

/** Stop 4: the agent pays the fare and the gate opens. */
export function FareArt() {
  return (
    <Disc id="fg-stop-fare" tint="#E0EEE5">
      <rect x="0" y="128" width="160" height="32" fill="#CFE3D6" />
      <line x1="0" y1="128" x2="160" y2="128" stroke="#1C1B18" strokeWidth="2" />
      <rect x="42" y="66" width="14" height="62" rx="2" fill="#1C1B18" />
      <rect x="104" y="66" width="14" height="62" rx="2" fill="#1C1B18" />
      <rect x="36" y="58" width="26" height="10" rx="2" fill="#1C1B18" />
      <rect x="98" y="58" width="26" height="10" rx="2" fill="#1C1B18" />
      <g transform="rotate(-38 56 96)">
        <rect x="56" y="92" width="52" height="8" rx="3" fill="#2446A6" />
      </g>
      <circle cx="80" cy="36" r="17" fill="#FBFAF6" stroke="#1E6A44" strokeWidth="3" />
      <text className={D} x="80" y="43" fontSize="19" textAnchor="middle" fill="#1E6A44">
        $
      </text>
      <path
        d="M71 60 L80 68 L89 60"
        fill="none"
        stroke="#1E6A44"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Disc>
  );
}

/** Stop 5: live data from three lending protocols. */
export function DataArt() {
  return (
    <Disc id="fg-stop-data" tint="#E3E8F5">
      <rect x="50" y="30" width="80" height="84" rx="5" fill="#ECE8DD" stroke="#1C1B18" strokeWidth="1.5" />
      <rect x="40" y="40" width="80" height="84" rx="5" fill="#F3F0E8" stroke="#1C1B18" strokeWidth="1.5" />
      <rect x="30" y="50" width="80" height="84" rx="5" fill="#FBFAF6" stroke="#1C1B18" strokeWidth="1.8" />
      <rect x="40" y="60" width="36" height="5" rx="2" fill="#BFB7A5" />
      <rect x="42" y="100" width="11" height="22" fill="#1C1B18" />
      <rect x="58" y="88" width="11" height="34" fill="#1C1B18" />
      <rect x="74" y="78" width="11" height="44" fill="#2446A6" />
      <rect x="90" y="94" width="11" height="28" fill="#1C1B18" />
    </Disc>
  );
}

/** One query document fanned out to three protocols. */
export function FanOutArt() {
  return (
    <svg viewBox="0 0 300 120" className="h-auto w-full" role="img" aria-label="One query fans out to Aave v3, Compound v3 and Spark">
      <rect x="4" y="44" width="92" height="32" rx="4" fill="#1C1B18" />
      <text className={M} x="50" y="64.5" fontSize="12" textAnchor="middle" fill="#FBFAF6">
        1 query
      </text>
      <g fill="none" stroke="#1C1B18" strokeWidth="1.5">
        <path d="M96 60 C130 60 130 20 164 20" />
        <path d="M96 60 H164" />
        <path d="M96 60 C130 60 130 100 164 100" />
      </g>
      <g fill="#FBFAF6" stroke="#BFB7A5">
        <rect x="164" y="6" width="132" height="28" rx="4" />
        <rect x="164" y="46" width="132" height="28" rx="4" />
        <rect x="164" y="86" width="132" height="28" rx="4" />
      </g>
      <g className={S} fontSize="12.5" fontWeight="500" fill="#1C1B18">
        <text x="178" y="24.5">Aave v3</text>
        <text x="178" y="64.5">Compound v3</text>
        <text x="178" y="104.5">Spark</text>
      </g>
      <g fill="#1E6A44">
        <circle cx="280" cy="20" r="7" />
        <circle cx="280" cy="60" r="7" />
        <circle cx="280" cy="100" r="7" />
      </g>
      <g fill="none" stroke="#FBFAF6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M276.5 20.2 L279 22.6 L283.6 17.4" />
        <path d="M276.5 60.2 L279 62.6 L283.6 57.4" />
        <path d="M276.5 100.2 L279 102.6 L283.6 97.4" />
      </g>
    </svg>
  );
}

/** Research agents pay per query. */
export function ResearchArt() {
  return (
    <svg viewBox="0 0 360 190" className="h-auto w-full" aria-hidden>
      <rect width="360" height="190" fill="#E3E8F5" />
      <circle cx="300" cy="36" r="54" fill="#D3DCF0" />
      <g transform="rotate(-4 155 99)">
        <rect x="80" y="34" width="150" height="130" rx="6" fill="#FBFAF6" stroke="#1C1B18" strokeWidth="1.8" />
        <rect x="96" y="50" width="70" height="7" rx="3" fill="#1C1B18" />
        <rect x="96" y="64" width="46" height="5" rx="2" fill="#BFB7A5" />
        <polyline
          points="98,138 124,116 148,126 172,96 208,108"
          fill="none"
          stroke="#2446A6"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="96" y1="148" x2="214" y2="148" stroke="#DDD7CA" strokeWidth="1.5" />
      </g>
      <circle cx="214" cy="112" r="34" fill="#FBFAF6" fillOpacity="0.45" stroke="#1C1B18" strokeWidth="6" />
      <line x1="239" y1="137" x2="268" y2="166" stroke="#1C1B18" strokeWidth="11" strokeLinecap="round" />
      <rect x="252" y="58" width="74" height="26" rx="4" fill="#1C1B18" />
      <text className={M} x="289" y="75.5" fontSize="12" textAnchor="middle" fill="#FBFAF6">
        $0.0102
      </text>
      <rect x="30" y="118" width="64" height="26" rx="4" fill="#FBFAF6" stroke="#1C1B18" strokeWidth="1.5" />
      <text className={M} x="62" y="135.5" fontSize="12" textAnchor="middle" fill="#1C1B18">
        $0.036
      </text>
    </svg>
  );
}

/** Treasury bots spend within a cap a person set. */
export function TreasuryArt() {
  return (
    <svg viewBox="0 0 360 190" className="h-auto w-full" aria-hidden>
      <rect width="360" height="190" fill="#F5E9D0" />
      <circle cx="56" cy="170" r="72" fill="#EEDDBB" />
      <rect x="110" y="30" width="140" height="130" rx="10" fill="#4A463E" />
      <rect x="122" y="42" width="116" height="106" rx="6" fill="#1C1B18" />
      <circle cx="180" cy="95" r="30" fill="#FBFAF6" stroke="#BFB7A5" strokeWidth="3" />
      <g stroke="#1C1B18" strokeWidth="3" strokeLinecap="round">
        <line x1="180" y1="70" x2="180" y2="78" />
        <line x1="205" y1="95" x2="197" y2="95" />
        <line x1="180" y1="120" x2="180" y2="112" />
        <line x1="155" y1="95" x2="163" y2="95" />
      </g>
      <line x1="180" y1="95" x2="194" y2="82" stroke="#95570A" strokeWidth="3" strokeLinecap="round" />
      <circle cx="180" cy="95" r="5" fill="#1C1B18" />
      <rect x="250" y="62" width="10" height="20" rx="2" fill="#4A463E" />
      <rect x="250" y="108" width="10" height="20" rx="2" fill="#4A463E" />
      <ellipse cx="304" cy="156" rx="30" ry="9" fill="#95570A" />
      <rect x="274" y="144" width="60" height="12" fill="#95570A" />
      <ellipse cx="304" cy="144" rx="30" ry="9" fill="#7E4A08" />
      <rect x="274" y="132" width="60" height="12" fill="#7E4A08" />
      <ellipse cx="304" cy="132" rx="30" ry="9" fill="#95570A" />
      <rect x="274" y="120" width="60" height="12" fill="#95570A" />
      <ellipse cx="304" cy="120" rx="30" ry="9" fill="#C58B2E" />
      <rect x="24" y="36" width="76" height="46" rx="5" fill="#FBFAF6" stroke="#1C1B18" strokeWidth="1.5" />
      <text className={D} x="34" y="53" fontSize="9.5" letterSpacing="0.8" fill="#787164">
        DAILY LIMIT
      </text>
      <text className={M} x="34" y="72" fontSize="14" fontWeight="500" fill="#1C1B18">
        $1.00
      </text>
    </svg>
  );
}

/** Trading assistants can be revoked in one transaction. */
export function TradingArt() {
  return (
    <svg viewBox="0 0 360 190" className="h-auto w-full" aria-hidden>
      <rect width="360" height="190" fill="#F6E1DD" />
      <circle cx="316" cy="176" r="80" fill="#EFCFC9" />
      <rect x="34" y="28" width="210" height="134" rx="8" fill="#1C1B18" />
      <rect x="46" y="40" width="186" height="110" rx="4" fill="#2A2925" />
      <g stroke="#8D8677" strokeWidth="1.5">
        <line x1="72" y1="62" x2="72" y2="112" />
        <line x1="102" y1="72" x2="102" y2="126" />
        <line x1="132" y1="56" x2="132" y2="104" />
        <line x1="162" y1="80" x2="162" y2="130" />
        <line x1="192" y1="64" x2="192" y2="116" />
      </g>
      <rect x="66" y="72" width="12" height="30" fill="#A8D5B9" />
      <rect x="96" y="84" width="12" height="30" fill="#E8A49C" />
      <rect x="126" y="66" width="12" height="28" fill="#A8D5B9" />
      <rect x="156" y="92" width="12" height="28" fill="#E8A49C" />
      <rect x="186" y="74" width="12" height="32" fill="#A8D5B9" />
      <g transform="rotate(-8 262 118)">
        <rect x="196" y="96" width="132" height="44" rx="3" fill="#F6E1DD" stroke="#B0261E" strokeWidth="3" />
        <text className={D} x="262" y="126" fontSize="21" letterSpacing="2.4" textAnchor="middle" fill="#B0261E">
          REVOKED
        </text>
      </g>
    </svg>
  );
}
