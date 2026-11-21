// PROTOTYPE, throw away.
// Variant A, "Timeline first": the day timeline is the page. One chart with
// Solar production, Charger power and Net power on a shared kW axis, and a
// Shadow decision lane underneath (Charging current as a step line, start/stop
// markers). Live figures and controls sit beside it (laptop) or above it (phone).
// Answers the open questions as: Charger power IS on the chart; you can page
// back to earlier days; Manual overrides are flags on the decision lane.
import { useState, useRef } from 'react';
import { days, fmt, kw, ago, decisionEvents, CHARGER_MAX } from './data.js';

const X0 = 7 * 60;
const X1 = 19 * 60;

function Chart({ day }) {
  const W = 1000;
  const H1 = 260; // power area
  const H2 = 90; // decision lane
  const pad = { l: 44, r: 12, t: 10 };
  const ref = useRef();
  const [hover, setHover] = useState(null);
  const x = (m) => pad.l + ((m - X0) / (X1 - X0)) * (W - pad.l - pad.r);
  const yMax = 5000;
  const yMin = -4000;
  const y = (w) => pad.t + ((yMax - w) / (yMax - yMin)) * H1;
  const lane0 = pad.t + H1 + 26;
  const ya = (a) => lane0 + H2 - (a / CHARGER_MAX) * H2;

  const mins = day.minutes.filter((p) => p.m >= X0 && p.m <= Math.min(X1, day.now));
  const solar = mins.filter((p) => p.m <= day.solarKnownUntil);
  const area = (pts, f) =>
    pts.length ? `M${x(pts[0].m)},${y(0)} ` + pts.map((p) => `L${x(p.m)},${y(f(p))}`).join(' ') + ` L${x(pts.at(-1).m)},${y(0)} Z` : '';
  const line = (pts, f) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.m)},${f(p)}`).join(' ');
  const decs = day.decisions.filter((d) => d.m >= X0 && d.m <= Math.min(X1, day.now));
  const events = decisionEvents(day).filter((d) => d.m >= X0 && d.m <= X1);

  // Paused stretches for hatching.
  const paused = [];
  for (const d of decs) {
    if (d.state === 'paused') {
      const last = paused.at(-1);
      if (last && last.to === d.m) last.to = d.m + 1;
      else paused.push({ from: d.m, to: d.m + 1 });
    }
  }
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const m = Math.round(X0 + ((px - pad.l) / (W - pad.l - pad.r)) * (X1 - X0));
    if (m < X0 || m > Math.min(X1, day.now)) return setHover(null);
    setHover({ m, left: e.clientX - r.left, top: e.clientY - r.top });
  };

  const hp = hover && day.minutes[hover.m];
  const hd = hover && day.decisions[hover.m];
  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${lane0 + H2 + 24}`} style={{ width: '100%', display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id="hatchA" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#bbb" strokeWidth="2" />
          </pattern>
        </defs>
        {/* grid */}
        {[-4000, -2000, 0, 2000, 4000].map((w) => (
          <g key={w}>
            <line x1={pad.l} x2={W - pad.r} y1={y(w)} y2={y(w)} stroke={w === 0 ? '#999' : '#eee'} />
            <text x={pad.l - 6} y={y(w) + 4} fontSize="11" textAnchor="end" fill="#888">
              {w / 1000}
            </text>
          </g>
        ))}
        <text x={4} y={pad.t + 10} fontSize="11" fill="#888">kW</text>
        {Array.from({ length: 13 }, (_, i) => X0 + i * 60).map((m) => (
          <text key={m} x={x(m)} y={lane0 + H2 + 18} fontSize="11" textAnchor="middle" fill="#888">
            {fmt(m).slice(0, 2)}
          </text>
        ))}
        {/* series */}
        <path d={area(solar, (p) => p.solar5)} fill="var(--solar)" opacity="0.35" stroke="var(--solar)" />
        {day.solarKnownUntil < day.now && (
          <g>
            <rect x={x(day.solarKnownUntil)} y={pad.t} width={x(day.now) - x(day.solarKnownUntil)} height={H1} fill="var(--solar)" opacity="0.07" />
            <text x={(x(day.solarKnownUntil) + x(day.now)) / 2} y={pad.t + 14} fontSize="11" textAnchor="middle" fill="#a07400">
              solar not fetched yet
            </text>
          </g>
        )}
        <path d={area(mins, (p) => p.charger)} fill="var(--charger)" opacity="0.25" />
        <path d={line(mins, (p) => y(p.net))} fill="none" stroke="#333" strokeWidth="1.3" />
        {/* now */}
        {day.now < 1440 && <line x1={x(day.now)} x2={x(day.now)} y1={pad.t} y2={lane0 + H2} stroke="#e5484d" strokeDasharray="3 3" />}
        {/* decision lane */}
        <text x={4} y={lane0 - 8} fontSize="11" fill="#555" fontWeight="600">Shadow decision · Charging current (A)</text>
        <rect x={pad.l} y={lane0} width={W - pad.l - pad.r} height={H2} fill="#fafafa" />
        {[6, 10, 16].map((a) => (
          <g key={a}>
            <line x1={pad.l} x2={W - pad.r} y1={ya(a)} y2={ya(a)} stroke="#eee" />
            <text x={pad.l - 6} y={ya(a) + 4} fontSize="10" textAnchor="end" fill="#888">{a}</text>
          </g>
        ))}
        {paused.map((p) => (
          <rect key={p.from} x={x(p.from)} y={lane0} width={x(p.to) - x(p.from)} height={H2} fill="url(#hatchA)" />
        ))}
        <path
          d={line(decs, (d) => ya(d.state === 'paused' ? 0 : d.amps))}
          fill="none"
          stroke="var(--shadow)"
          strokeWidth="2"
        />
        <path
          d={line(decs.filter((d) => d.state === 'paused'), (d) => ya(+(d.underlying?.match(/\d+/)?.[0] ?? 0)))}
          fill="none"
          stroke="var(--shadow)"
          strokeDasharray="2 3"
          opacity="0.5"
        />
        {events
          .filter((e) => e.event !== 'current')
          .map((e) => (
            <g key={e.m} transform={`translate(${x(e.m)},${e.event === 'start' ? ya(e.amps) - 6 : ya(0) - 6})`}>
              <path d={e.event === 'start' ? 'M-5,0 L5,0 L0,-8 Z' : 'M-5,-8 L5,-8 L0,0 Z'} fill={e.event === 'start' ? 'var(--shadow)' : '#e5484d'} />
              {e.event === 'start' && <text y={-11} fontSize="10" textAnchor="middle" fill="var(--shadow)">{e.amps} A</text>}
            </g>
          ))}
        {day.overrides.map((o) => (
          <g key={o.m} transform={`translate(${x(o.m)},${lane0})`}>
            <line y1={0} y2={H2} stroke="#1c2024" />
            <path d="M0,0 L12,4 L0,8 Z" fill="#1c2024" />
            <text x={14} y={8} fontSize="10" fill="#1c2024">{o.kind === 'pause' ? 'Pause' : 'Resume'} · {o.by}</text>
          </g>
        ))}
        {hover && <line x1={x(hover.m)} x2={x(hover.m)} y1={pad.t} y2={lane0 + H2} stroke="#000" opacity="0.3" />}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(hover.left + 12, 600), top: hover.top + 12 }}>
          <b>{fmt(hover.m)}</b>
          <br />
          Solar production: {hover.m <= day.solarKnownUntil ? kw(hp.solar5) : '—'}
          <br />
          Net power: {kw(hp.net)} ({hp.net > 0 ? 'import' : 'export'})
          <br />
          Charger power: {kw(hp.charger)}
          <br />
          Surplus: {kw(hp.surplus)}
          <br />
          Shadow: <b>{hd.label}</b>
          {hd.underlying && <> (would be: {hd.underlying})</>}
          {hd.limit && <> · limited by {hd.limit}</>}
        </div>
      )}
      <div className="small muted" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
        <span><Sw c="var(--solar)" /> Solar production (5-min, Enphase)</span>
        <span><Sw c="var(--charger)" /> Charger power</span>
        <span><Sw c="#333" line /> Net power (+ import / − export)</span>
        <span><Sw c="var(--shadow)" line /> Shadow Charging current</span>
        <span>▲ start ▼ stop ⚑ Manual override ▨ paused</span>
      </div>
    </div>
  );
}

const Sw = ({ c, line }) => (
  <span style={{ display: 'inline-block', width: 12, height: line ? 2 : 10, background: c, verticalAlign: 'middle', opacity: line ? 1 : 0.6 }} />
);

function NowPanel({ live, override, sendOverride }) {
  const d = live.decision;
  return (
    <div className="card a-now">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b>Now</b>
        <span className={live.stream === 'connected' ? 'small muted' : 'small stale'}>
          ● {live.stream === 'connected' ? 'live' : 'reconnecting…'}
        </span>
      </div>
      <div className="a-figs">
        <Fig label="Surplus" v={kw(live.surplusW)} age={live.age.p1} />
        <Fig label="Net power" v={kw(live.netW)} age={live.age.p1} />
        <Fig label="Charger power" v={kw(live.chargerW)} age={live.age.zaptec} />
        <Fig label="Solar production" v={kw(live.solarW)} sub={`as of ${fmt(live.solarAsOf)}`} action="Refresh" />
      </div>
      <div style={{ borderTop: '1px solid #eee', paddingTop: 10, marginTop: 4 }}>
        <div className="small muted">Shadow decision</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: d.state === 'charging' ? 'var(--shadow)' : undefined }}>{d.label}</div>
        {d.underlying && <div className="small muted">Would otherwise: {d.underlying}</div>}
        {d.limit && <div className="small">Limited by <b>{d.limit}</b></div>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {live.canResume ? (
          <button className="btn btn-resume" onClick={() => sendOverride('resume')}>Resume</button>
        ) : (
          <button className="btn btn-pause" disabled={!live.canPause} onClick={() => sendOverride('pause')} title={live.pauseReason}>Pause</button>
        )}
        <span className="small muted">{live.switchesLeft} of 20 switches left</span>
      </div>
      {!live.canPause && !live.canResume && <div className="small muted">{live.pauseReason}</div>}
      {override && <div className="small" style={{ marginTop: 6 }}>{override.kind === 'pause' ? 'Pause' : 'Resume'}: <b>{override.step}</b></div>}
    </div>
  );
}

function Fig({ label, v, age, sub, action }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{v}</div>
      <div className={age > 60 ? 'small stale' : 'small muted'}>
        {sub ?? ago(age)} {action && <a href="#" onClick={(e) => e.preventDefault()}>{action}</a>}
      </div>
    </div>
  );
}

function EventList({ day }) {
  const ev = [
    ...decisionEvents(day).map((d) => ({ m: d.m, text: d.event === 'start' ? `Would start at ${d.amps} A` : d.event === 'stop' ? `Would stop (${d.reason})` : `Would change to ${d.amps} A (${d.limit})` })),
    ...day.overrides.map((o) => ({ m: o.m, text: `${o.kind === 'pause' ? 'Paused' : 'Resumed'} by ${o.by} via ${o.via}`, strong: true })),
  ].sort((a, b) => b.m - a.m);
  return (
    <div className="card">
      <b>Decisions · {day.title}</b>
      <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 6 }}>
        {ev.map((e, i) => (
          <div key={i} className="small" style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0', fontWeight: e.strong ? 600 : 400 }}>
            <span className="muted">{fmt(e.m)}</span> {e.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VariantA({ live, override, sendOverride }) {
  const [di, setDi] = useState(days.length - 1);
  const day = days[di];
  return (
    <div style={{ padding: 12 }}>
      <style>{`
        .a-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
        .a-figs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
        @container (min-width: 900px) {
          .a-grid { grid-template-columns: 1fr 320px; align-items: start; }
          .a-chart { grid-column: 1; grid-row: 1 / span 2; }
          .a-nowcell { grid-column: 2; grid-row: 1; }
          .a-events { grid-column: 2; grid-row: 2; }
        }
      `}</style>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 18 }}>☀︎ ChargeOnSolar</b>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn" style={{ padding: '6px 10px' }} disabled={di === 0} onClick={() => setDi(di - 1)}>‹</button>
          <span style={{ minWidth: 120, textAlign: 'center' }}>
            <b>{day.title}</b> <span className="muted small">{day.date}</span>
          </span>
          <button className="btn" style={{ padding: '6px 10px' }} disabled={di === days.length - 1} onClick={() => setDi(di + 1)}>›</button>
        </div>
      </header>
      {live.apmOff && (
        <div className="warn" style={{ marginBottom: 12 }}>
          ⚠ Zaptec load balancing (APM) is off. The main fuse is not protected by Zaptec right now. Turn it back on in the Zaptec app.
        </div>
      )}
      <div className="a-grid">
        <div className="a-nowcell">
          <NowPanel live={live} override={override} sendOverride={sendOverride} />
        </div>
        <div className="card a-chart">
          <Chart day={day} />
        </div>
        <div className="a-events">
          <EventList day={day} />
        </div>
      </div>
    </div>
  );
}
