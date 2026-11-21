// PROTOTYPE, throw away.
// Variant B, "Now first": the page answers "what would it do right now, and why?".
// A big Shadow decision sentence, a power-flow picture (Solar → House / Car / Grid),
// one large Pause/Resume button. The day is a compact colour strip of Shadow
// decisions with a small Surplus sparkline, today only.
// Answers the open questions as: no Charger power on the strip (it's in the flow
// picture); today only, no earlier days in v1; Manual overrides are pins on the strip.
import { useState } from 'react';
import { today as day, fmt, kw, ago, CHARGER_MAX, MIN_A, V } from './data.js';

export function Hero({ live }) {
  const d = live.decision;
  const big =
    d.state === 'charging' ? `Would charge at ${d.amps} A` : d.state === 'paused' ? d.label : d.state === 'no-car' ? 'No car connected' : 'Would not charge';
  const why =
    d.state === 'charging'
      ? d.limit === 'Fuse headroom'
        ? `Limited by Fuse headroom (${Math.floor(live.fuseHeadroomA)} A left on the busiest phase).`
        : d.limit === 'Charger max'
          ? `At the charger maximum (${CHARGER_MAX} A).`
          : `Limited by Surplus: ${kw(d.a5)} on average over 5 minutes ≈ ${Math.floor(d.a5 / V)} A on 1 phase.`
      : d.state === 'paused'
        ? `Without the pause it would be: ${d.underlying}.`
        : d.state === 'no-car'
          ? 'Plug in the car to see Shadow decisions.'
          : `Surplus is below ${MIN_A} A worth (${kw(MIN_A * V, 2)}).`;
  return (
    <div className="card b-hero" style={{ background: d.state === 'charging' ? '#e9f7ef' : '#fff' }}>
      <div className="small muted">Shadow decision · not sent to the charger</div>
      <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.15, margin: '6px 0', color: d.state === 'charging' ? 'var(--shadow)' : undefined }}>{big}</div>
      <div>{why}</div>
      <div className="small muted" style={{ marginTop: 8 }}>
        Charger: {live.charger.state} · {live.charger.phaseSetting} · max {live.charger.maxA} A · {live.charger.mode}
      </div>
    </div>
  );
}

export function Flow({ live }) {
  // Solar is lagging (Enphase), so House is derived from live figures where possible:
  // House consumption = Net power + Solar − Charger. Shown dimmed because solar is stale.
  const exporting = live.netW < 0;
  const node = (x, y, label, v, c, sub) => (
    <g transform={`translate(${x},${y})`}>
      <circle r="38" fill="#fff" stroke={c} strokeWidth="3" />
      <text y="-6" textAnchor="middle" fontSize="12" fill="#555">{label}</text>
      <text y="12" textAnchor="middle" fontSize="15" fontWeight="700">{v}</text>
      {sub && <text y="56" textAnchor="middle" fontSize="11" fill="#a07400">{sub}</text>}
    </g>
  );
  return (
    <div className="card">
      <svg viewBox="0 0 320 250" style={{ width: '100%', maxWidth: 420, display: 'block', margin: '0 auto' }}>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="#888" />
          </marker>
        </defs>
        <line x1="160" y1="80" x2="160" y2="120" stroke="var(--solar)" strokeWidth="4" markerEnd="url(#arr)" />
        <line x1="130" y1="160" x2="82" y2="190" stroke="var(--charger)" strokeWidth={live.chargerW > 0 ? 4 : 1} markerEnd="url(#arr)" />
        <line
          x1={exporting ? 190 : 238}
          y1={exporting ? 160 : 190}
          x2={exporting ? 238 : 190}
          y2={exporting ? 190 : 160}
          stroke={exporting ? 'var(--net-export)' : 'var(--net-import)'}
          strokeWidth="4"
          markerEnd="url(#arr)"
        />
        {node(160, 42, 'Solar', kw(live.solarW), 'var(--solar)', '')}
        <text x="205" y="40" fontSize="10" fill="#a07400">as of {fmt(live.solarAsOf)}</text>
        <text x="205" y="53" fontSize="10" fill="#2563eb" style={{ cursor: 'pointer' }}>↻ refresh</text>
        {node(160, 150, 'Surplus', kw(live.surplusW), 'var(--surplus)')}
        {node(52, 205, 'Car', kw(live.chargerW), 'var(--charger)')}
        {node(268, 205, exporting ? 'To grid' : 'From grid', kw(Math.abs(live.netW)), exporting ? 'var(--net-export)' : 'var(--net-import)')}
      </svg>
      <div className="small muted" style={{ textAlign: 'center' }}>
        P1 {ago(live.age.p1)} · Zaptec {ago(live.age.zaptec)} · <span className={live.stream === 'connected' ? '' : 'stale'}>{live.stream === 'connected' ? '● live' : '● reconnecting…'}</span>
      </div>
    </div>
  );
}

export function Controls({ live, override, sendOverride }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      {live.canResume ? (
        <button className="btn btn-resume" style={{ width: '100%', fontSize: 20, padding: 18 }} onClick={() => sendOverride('resume')}>
          ▶ Resume charging
        </button>
      ) : (
        <button className="btn btn-pause" style={{ width: '100%', fontSize: 20, padding: 18 }} disabled={!live.canPause} onClick={() => sendOverride('pause')}>
          ❚❚ Pause charging
        </button>
      )}
      <div className="small muted" style={{ marginTop: 8 }}>
        {override ? (
          <span style={{ color: '#1c2024' }}>
            {['Sending', 'Accepted', 'Confirmed'].map((s, i, a) => (
              <span key={s} style={{ fontWeight: override.step === s ? 700 : 400, opacity: a.indexOf(override.step) >= i ? 1 : 0.35 }}>
                {s}
                {i < 2 ? ' → ' : ''}
              </span>
            ))}
          </span>
        ) : !live.canPause && !live.canResume ? (
          live.pauseReason
        ) : (
          `${live.switchesLeft} of 20 switches left this session`
        )}
      </div>
    </div>
  );
}

function DayStrip() {
  const [sel, setSel] = useState(null);
  const X0 = 7 * 60;
  const X1 = 19 * 60;
  const W = 600;
  const x = (m) => ((m - X0) / (X1 - X0)) * W;
  const decs = day.decisions.filter((d) => d.m >= X0 && d.m < day.now);
  const mins = day.minutes.filter((p) => p.m >= X0 && p.m < day.now);
  const color = (d) =>
    d.state === 'charging' ? `rgba(11,122,62,${0.25 + (d.amps / CHARGER_MAX) * 0.75})` : d.state === 'paused' ? '#c9c9d0' : d.state === 'no-car' ? '#f2f2f4' : '#e2e2e6';
  const sMax = 4500;
  const ys = (w) => 40 - (Math.max(-500, w) / sMax) * 38;
  const d = sel != null ? day.decisions[sel] : null;
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <b>Today</b>
        <span className="small muted">tap the strip for details</span>
      </div>
      <svg
        viewBox={`0 0 ${W} 92`}
        style={{ width: '100%', display: 'block', marginTop: 6 }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const m = Math.round(X0 + ((e.clientX - r.left) / r.width) * (X1 - X0));
          setSel(m < day.now ? m : null);
        }}
      >
        <path d={mins.map((p, i) => `${i ? 'L' : 'M'}${x(p.m)},${ys(p.surplus)}`).join(' ')} fill="none" stroke="var(--surplus)" strokeWidth="1.2" />
        <line x1="0" x2={W} y1={ys(MIN_A * V)} y2={ys(MIN_A * V)} stroke="var(--surplus)" strokeDasharray="3 3" opacity="0.6" />
        <text x={W - 2} y={ys(MIN_A * V) - 3} fontSize="9" textAnchor="end" fill="var(--surplus)">6 A</text>
        {decs.map((d) => (
          <rect key={d.m} x={x(d.m)} y={46} width={x(d.m + 1) - x(d.m) + 0.3} height={22} fill={color(d)} />
        ))}
        {day.overrides.map((o) => (
          <g key={o.m}>
            <line x1={x(o.m)} x2={x(o.m)} y1={44} y2={70} stroke="#1c2024" strokeWidth="1.5" />
            <circle cx={x(o.m)} cy={44} r="3.5" fill="#1c2024" />
          </g>
        ))}
        <line x1={x(day.now)} x2={x(day.now)} y1={0} y2={70} stroke="#e5484d" strokeDasharray="3 3" />
        {sel != null && <line x1={x(sel)} x2={x(sel)} y1={0} y2={70} stroke="#000" />}
        {[7, 9, 11, 13, 15, 17, 19].map((h) => (
          <text key={h} x={x(h * 60)} y={86} fontSize="10" textAnchor="middle" fill="#888">{h}:00</text>
        ))}
      </svg>
      <div className="small" style={{ minHeight: 34 }}>
        {d ? (
          <>
            <b>{fmt(sel)}</b> · {d.label}
            {d.underlying && ` (would be: ${d.underlying})`}
            {d.limit && ` · limited by ${d.limit}`} · Surplus {kw(day.minutes[sel].surplus)}
          </>
        ) : (
          <span className="muted">Green = would charge (darker = more amps) · grey = would not · dots = Manual overrides · line = Surplus</span>
        )}
      </div>
    </div>
  );
}

export default function VariantB({ live, override, sendOverride }) {
  return (
    <div style={{ padding: 12, maxWidth: 1200, margin: '0 auto' }}>
      <style>{`
        .b-grid { display: grid; gap: 12px; }
        @container (min-width: 900px) {
          .b-grid { grid-template-columns: 1.1fr 1fr; align-items: start; }
          .b-left, .b-right { display: grid; gap: 12px; }
          .b-strip { grid-column: 1 / span 2; }
        }
        @container (max-width: 899px) { .b-left, .b-right { display: contents; } }
      `}</style>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <b style={{ fontSize: 18 }}>☀︎ ChargeOnSolar</b>
        <span className="small muted">Sat 21 Nov · {fmt(day.now)}</span>
      </header>
      {live.apmOff && (
        <div className="warn" style={{ marginBottom: 12 }}>
          ⚠ <b>APM is off.</b> Zaptec isn't protecting the main fuse. Turn load balancing back on in the Zaptec app.
        </div>
      )}
      <div className="b-grid">
        <div className="b-left">
          <Hero live={live} />
          <Controls live={live} override={override} sendOverride={sendOverride} />
        </div>
        <div className="b-right">
          <Flow live={live} />
        </div>
        <div className="b-strip">
          <DayStrip />
        </div>
      </div>
    </div>
  );
}
