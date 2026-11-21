// PROTOTYPE, throw away.
// Variant D, "B's Now + stacked day chart": the user's pick after A/B/C.
// Top: B's Shadow decision sentence, Pause/Resume button and power-flow circles.
// Below: a day chart close to A, styled after the HomeWizard app's day chart:
// stacked, smoothed, overlapping areas that show where power comes from and goes to.
//   Solar used (blue)  = Solar production consumed in the house incl. the car
//   From grid (purple) = the rest of the consumption, imported
//   To grid (green)    = Solar production not consumed, exported
// On top of that: Charger power as a line, and A's Shadow decision lane below.
// HomeWizard calls the green part "Surplus"; in our glossary Surplus means
// something else (power that would flow to the grid if the charger drew nothing),
// so here it is "To grid".
import { useState, useRef } from 'react';
import { days, fmt, kw, decisionEvents, CHARGER_MAX } from './data.js';
import { Hero, Flow, Controls } from './VariantB.jsx';

const X0 = 0;
const X1 = 1440;
const STEP = 5; // 5-min buckets, same as Enphase

function buckets(day) {
  const out = [];
  for (let b = 0; b < Math.min(day.now, 1440); b += STEP) {
    const ps = day.minutes.slice(b, Math.min(b + STEP, day.now));
    const avg = (f) => ps.reduce((s, p) => s + f(p), 0) / ps.length;
    const known = b < day.solarKnownUntil;
    const solar = known ? ps[0].solar5 : null;
    const net = avg((p) => p.net);
    const charger = avg((p) => p.charger);
    if (solar == null) {
      out.push({ m: b, known: false, net, charger, fromGrid: Math.max(0, net), toGrid: Math.max(0, -net) });
      continue;
    }
    const consumption = net + solar; // house + charger
    const used = Math.min(solar, Math.max(0, consumption));
    out.push({ m: b, known: true, solar, net, charger, consumption, used, fromGrid: Math.max(0, consumption - used), toGrid: Math.max(0, solar - used) });
  }
  return out;
}

// Smooth line through points (Catmull-Rom → cubic Bézier).
function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`;
  }
  return d;
}
const band = (pts, top, bottom) => {
  const b0 = bottom(pts[0]);
  return `${smooth(pts.map((p) => [p.x, top(p)]))} L${pts.at(-1).x},${b0} L${pts[0].x},${b0} Z`;
};

const C = { used: '#38b6f0', grid: '#9b2ee8', toGrid: '#22c55e', charger: '#ffffff', shadow: '#22c55e' };

function DayChart({ day }) {
  const W = 1000;
  const H = 260;
  const pad = { l: 8, r: 46, t: 12 };
  const lane0 = pad.t + H + 30;
  const LH = 56;
  const ref = useRef();
  const [hover, setHover] = useState(null);
  const bs = buckets(day);
  const max = Math.max(3000, Math.ceil(Math.max(...bs.map((b) => Math.max(b.consumption ?? b.fromGrid, b.solar ?? 0))) / 1000) * 1000);
  const x = (m) => pad.l + ((m - X0) / (X1 - X0)) * (W - pad.l - pad.r);
  const y = (w) => pad.t + H - (w / max) * H;
  const ya = (a) => lane0 + LH - (a / CHARGER_MAX) * LH;
  const pts = bs.map((b) => ({ ...b, x: x(b.m + STEP / 2) }));
  const known = pts.filter((p) => p.known);
  const unknown = pts.filter((p) => !p.known);
  const decs = day.decisions.filter((d) => d.m < day.now && d.m % STEP === 0);
  const events = decisionEvents(day).filter((e) => e.event !== 'current');

  const kwh = (f) => (bs.reduce((s, b) => s + (f(b) ?? 0), 0) * STEP) / 60 / 1000;
  const totals = { used: kwh((b) => b.used), grid: kwh((b) => b.fromGrid), toGrid: kwh((b) => b.toGrid), charger: kwh((b) => b.charger) };

  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const m = Math.floor((X0 + ((px - pad.l) / (W - pad.l - pad.r)) * (X1 - X0)) / STEP) * STEP;
    const b = bs.find((q) => q.m === m);
    setHover(b ? { b, left: e.clientX - r.left, top: e.clientY - r.top } : null);
  };
  const hd = hover && day.decisions[hover.b.m];

  return (
    <div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>
          <span style={{ color: C.used }}>{totals.used.toFixed(1)}</span> <span style={{ color: C.grid }}>{totals.grid.toFixed(1)}</span>{' '}
          <span style={{ color: C.toGrid }}>{totals.toGrid.toFixed(1)}</span> <span style={{ color: '#ddd' }}>{totals.charger.toFixed(1)}</span>{' '}
          <span style={{ color: '#888', fontSize: 15 }}>kWh</span>
        </span>
        <span className="small" style={{ color: '#aaa', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span><Dot c={C.used} /> Solar used</span>
          <span><Dot c={C.grid} /> From grid</span>
          <span><Dot c={C.toGrid} /> To grid</span>
          <span><Dot c={C.charger} /> Charger power</span>
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg ref={ref} viewBox={`0 0 ${W} ${lane0 + LH + 26}`} style={{ width: '100%', display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            {Object.entries({ used: C.used, grid: C.grid, toGrid: C.toGrid }).map(([k, c]) => (
              <linearGradient key={k} id={`g-${k}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={c} stopOpacity="0.95" />
                <stop offset="1" stopColor={c} stopOpacity="0.35" />
              </linearGradient>
            ))}
            <pattern id="hatchD" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#555" strokeWidth="2" />
            </pattern>
          </defs>
          {Array.from({ length: max / 500 + 1 }, (_, i) => i * 500).map((w) => (
            <g key={w}>
              <line x1={pad.l} x2={W - pad.r} y1={y(w)} y2={y(w)} stroke="#2a2a2e" />
              <text x={W - pad.r + 6} y={y(w) + 4} fontSize="11" fill="#888">{w}</text>
            </g>
          ))}
          {/* consumption = solar used + from grid; solar = solar used + to grid (overlapping, like HomeWizard) */}
          {known.length > 1 && (
            <>
              <path d={band(known, (p) => y(p.consumption), () => y(0))} fill="url(#g-grid)" />
              <path d={band(known, (p) => y(p.solar), () => y(0))} fill="url(#g-toGrid)" />
              <path d={band(known, (p) => y(p.used), () => y(0))} fill="url(#g-used)" />
            </>
          )}
          {/* after the last Enphase fetch only Net power is known */}
          {unknown.length > 1 && (
            <>
              <rect x={unknown[0].x} y={pad.t} width={x(day.now) - unknown[0].x} height={H} fill="url(#hatchD)" opacity="0.35" />
              <path d={band(unknown, (p) => y(p.fromGrid), () => y(0))} fill={C.grid} opacity="0.6" />
              <path d={band(unknown, (p) => y(p.toGrid), () => y(0))} fill={C.toGrid} opacity="0.6" />
              <text x={(unknown[0].x + x(day.now)) / 2} y={pad.t + 14} fontSize="11" textAnchor="middle" fill="#f5b301">solar not fetched yet · ↻</text>
            </>
          )}
          <path d={smooth(pts.map((p) => [p.x, y(p.charger)]))} fill="none" stroke={C.charger} strokeWidth="1.6" strokeDasharray="5 3" />
          {day.now < 1440 && <line x1={x(day.now)} x2={x(day.now)} y1={pad.t} y2={lane0 + LH} stroke="#ff5d5d" strokeDasharray="3 3" />}
          {/* Shadow decision lane */}
          <text x={pad.l} y={lane0 - 8} fontSize="11" fill="#aaa">Shadow decision · Charging current</text>
          <rect x={pad.l} y={lane0} width={W - pad.l - pad.r} height={LH} fill="#17171a" />
          {[6, 16].map((a) => (
            <g key={a}>
              <line x1={pad.l} x2={W - pad.r} y1={ya(a)} y2={ya(a)} stroke="#2a2a2e" />
              <text x={W - pad.r + 6} y={ya(a) + 4} fontSize="10" fill="#888">{a} A</text>
            </g>
          ))}
          {decs.map((d) => (
            <rect
              key={d.m}
              x={x(d.m)}
              y={ya(d.state === 'paused' ? +(d.underlying?.match(/\d+/)?.[0] ?? 0) : d.amps)}
              width={x(d.m + STEP) - x(d.m) + 0.4}
              height={lane0 + LH - ya(d.state === 'paused' ? +(d.underlying?.match(/\d+/)?.[0] ?? 0) : d.amps)}
              fill={d.state === 'paused' ? 'url(#hatchD)' : C.shadow}
              opacity={d.state === 'paused' ? 1 : 0.8}
            />
          ))}
          {events.map((e) => (
            <g key={e.m} transform={`translate(${x(e.m)},${e.event === 'start' ? ya(e.amps) - 4 : lane0 + LH - 2})`}>
              <path d={e.event === 'start' ? 'M-5,0 L5,0 L0,-8 Z' : 'M-5,-8 L5,-8 L0,0 Z'} fill={e.event === 'start' ? C.shadow : '#ff5d5d'} />
              {e.event === 'start' && <text y={-11} fontSize="10" textAnchor="middle" fill={C.shadow}>{e.amps} A</text>}
            </g>
          ))}
          {day.overrides.map((o) => (
            <g key={o.m} transform={`translate(${x(o.m)},${lane0})`}>
              <line y1={0} y2={LH} stroke="#fff" />
              <path d="M0,0 L11,4 L0,8 Z" fill="#fff" />
              <text x={13} y={8} fontSize="10" fill="#ddd">{o.kind === 'pause' ? 'Pause' : 'Resume'} · {o.by}</text>
            </g>
          ))}
          {[2, 7, 12, 17, 22].map((h) => (
            <text key={h} x={x(h * 60)} y={lane0 + LH + 18} fontSize="11" textAnchor="middle" fill="#888">{String(h).padStart(2, '0')}:00</text>
          ))}
          {hover && <line x1={x(hover.b.m + STEP / 2)} x2={x(hover.b.m + STEP / 2)} y1={pad.t} y2={lane0 + LH} stroke="#fff" opacity="0.4" />}
        </svg>
        {hover && (
          <div className="tooltip" style={{ left: Math.min(hover.left + 12, 560), top: hover.top + 12 }}>
            <b>{fmt(hover.b.m)}–{fmt(hover.b.m + STEP)}</b>
            <br />
            {hover.b.known ? (
              <>
                Solar production: {kw(hover.b.solar, 2)}
                <br />
                Solar used: {kw(hover.b.used, 2)} · From grid: {kw(hover.b.fromGrid, 2)} · To grid: {kw(hover.b.toGrid, 2)}
              </>
            ) : (
              <>Net power: {kw(hover.b.net, 2)} (solar not fetched yet)</>
            )}
            <br />
            Charger power: {kw(hover.b.charger, 2)}
            <br />
            Shadow: <b>{hd.label}</b>
            {hd.underlying && <> (would be: {hd.underlying})</>}
            {hd.limit && <> · limited by {hd.limit}</>}
          </div>
        )}
      </div>
    </div>
  );
}

const Dot = ({ c }) => <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: c }} />;

export default function VariantD({ live, override, sendOverride }) {
  const [di, setDi] = useState(days.length - 1);
  const day = days[di];
  return (
    <div style={{ padding: 12, maxWidth: 1200, margin: '0 auto' }}>
      <style>{`
        .d-grid { display: grid; gap: 12px; }
        .d-chart { background: #0b0b0d; color: #eee; border-radius: 12px; padding: 14px; }
        @container (min-width: 900px) {
          .d-grid { grid-template-columns: 1.1fr 1fr; align-items: start; }
          .d-left, .d-right { display: grid; gap: 12px; }
          .d-chart { grid-column: 1 / span 2; }
        }
        @container (max-width: 899px) { .d-left, .d-right { display: contents; } }
      `}</style>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <b style={{ fontSize: 18 }}>☀︎ ChargeOnSolar</b>
        <span className="small muted">Sat 21 Nov</span>
      </header>
      {live.apmOff && (
        <div className="warn" style={{ marginBottom: 12 }}>
          ⚠ <b>APM is off.</b> Zaptec isn't protecting the main fuse. Turn load balancing back on in the Zaptec app.
        </div>
      )}
      <div className="d-grid">
        <div className="d-left">
          <Hero live={live} />
          <Controls live={live} override={override} sendOverride={sendOverride} />
        </div>
        <div className="d-right">
          <Flow live={live} />
        </div>
        <div className="d-chart">
          <DayChart day={day} />
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18, marginTop: 8 }}>
            <button className="btn" style={{ background: 'transparent', color: '#eee', fontSize: 22 }} disabled={di === 0} onClick={() => setDi(di - 1)}>‹</button>
            <span style={{ fontSize: 18, fontWeight: 600, minWidth: 110, textAlign: 'center' }}>{day.title}</span>
            <button className="btn" style={{ background: 'transparent', color: di === days.length - 1 ? '#444' : '#eee', fontSize: 22 }} disabled={di === days.length - 1} onClick={() => setDi(di + 1)}>›</button>
            <button className="btn" style={{ background: 'transparent', color: di === days.length - 1 ? '#444' : '#eee', fontSize: 18 }} disabled={di === days.length - 1} onClick={() => setDi(days.length - 1)}>⇥</button>
          </div>
        </div>
      </div>
    </div>
  );
}
