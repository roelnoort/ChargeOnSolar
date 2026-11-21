// PROTOTYPE, throw away.
// Variant E, after review of D:
// - Two tabs: Now (B's decision sentence, Pause/Resume, flow circles) and Day.
// - Day tab: two charts of the same kind on one time axis:
//     1. Real: what really happened.
//     2. Shadow: what would have happened if the Shadow decisions had been sent
//        (Charger power = Shadow Charging current × 230 V × phases; House the same).
// - Consumption is split into House and Car, each coloured by its source:
//     House from solar (blue), House from grid (purple),
//     Car from solar (orange), Car from grid (dark orange), To grid (green).
//   Solar covers the house first, then the car, so the stack never has gaps.
// - Light and dark mode follow the system setting (prototype bar can force one).
import { useState, useRef } from 'react';
import { days, today, fmt, kw, ago, decisionEvents, CHARGER_MAX, MIN_A, V } from './data.js';
import { useParam } from './shared.jsx';

const STEP = 5;
const PHASES = 1; // the user's Phase setting in the made-up data

// ---- data -----------------------------------------------------------------

function shadowChargerW(d) {
  return d.state === 'charging' ? d.amps * V * PHASES : 0;
}

/** 5-min buckets for one day, as really happened or as the Shadow decisions would have it. */
function buckets(day, mode) {
  const out = [];
  for (let b = 0; b < Math.min(day.now, 1440); b += STEP) {
    const ms = day.minutes.slice(b, Math.min(b + STEP, day.now));
    const avg = (f) => ms.reduce((s, p) => s + f(p), 0) / ms.length;
    const car = mode === 'real' ? avg((p) => p.charger) : avg((p) => shadowChargerW(day.decisions[p.m]));
    const net = avg((p) => p.net - p.charger) + car; // house's net exchange + this car
    const known = b < day.solarKnownUntil;
    if (!known) {
      out.push({ m: b, known, car, net, fromGrid: Math.max(0, net), toGrid: Math.max(0, -net) });
      continue;
    }
    const solar = ms[0].solar5;
    const house = Math.max(0, net + solar - car);
    const houseSolar = Math.min(solar, house);
    const houseGrid = house - houseSolar;
    const carSolar = Math.min(solar - houseSolar, car);
    const carGrid = car - carSolar;
    const toGrid = Math.max(0, solar - houseSolar - carSolar);
    out.push({ m: b, known, solar, net, house, car, houseSolar, houseGrid, carSolar, carGrid, toGrid });
  }
  return out;
}

function totals(bs) {
  const kwh = (f) => (bs.reduce((s, b) => s + (f(b) || 0), 0) * STEP) / 60000;
  const car = kwh((b) => b.car);
  const carSolar = kwh((b) => b.carSolar);
  const carKnown = kwh((b) => (b.known ? b.car : 0));
  return {
    houseSolar: kwh((b) => b.houseSolar),
    houseGrid: kwh((b) => b.houseGrid),
    carSolar,
    carGrid: kwh((b) => b.carGrid),
    toGrid: kwh((b) => b.toGrid),
    car,
    carSolarShare: carKnown > 0 ? carSolar / carKnown : null,
  };
}

// ---- chart ----------------------------------------------------------------

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
// Area between two smoothed edges.
function band(pts, top, bottom) {
  const up = pts.map((p) => [p.x, top(p)]);
  const down = pts.map((p) => [p.x, bottom(p)]).reverse();
  const downPath = smooth(down).replace(/^M[^C]*/, '');
  return `${smooth(up)} L${down[0][0]},${down[0][1]}${downPath} Z`;
}

const LAYERS = [
  ['houseSolar', 'House from solar', 'var(--e-house-solar)'],
  ['houseGrid', 'House from grid', 'var(--e-house-grid)'],
  ['carSolar', 'Car from solar', 'var(--e-car-solar)'],
  ['carGrid', 'Car from grid', 'var(--e-car-grid)'],
  ['toGrid', 'To grid', 'var(--e-to-grid)'],
];

const W = 1000;
const PAD = { l: 8, r: 50, t: 8 };
const H = 200;
const x = (m) => PAD.l + (m / 1440) * (W - PAD.l - PAD.r);

function StackChart({ id, day, bs, max, title, subtitle, sum, hover, setHover, shadow }) {
  const ref = useRef();
  const y = (w) => PAD.t + H - (w / max) * H;
  const pts = bs.map((b) => ({ ...b, x: x(b.m + STEP / 2) }));
  const known = pts.filter((p) => p.known);
  const unknown = pts.filter((p) => !p.known);
  // cumulative stack edges
  const edge = (p, upto) => LAYERS.slice(0, upto).reduce((s, [k]) => s + (p[k] || 0), 0);
  const events = shadow ? decisionEvents(day) : [];
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const m = Math.floor((((px - PAD.l) / (W - PAD.l - PAD.r)) * 1440) / STEP) * STEP;
    setHover(m >= 0 && m < day.now ? { m, chart: id, left: e.clientX - r.left, top: e.clientY - r.top } : null);
  };
  const b = hover && bs.find((q) => q.m === hover.m);
  const d = hover && day.decisions[hover.m];
  return (
    <div className="e-chart">
      <div className="e-chart-head">
        <div>
          <b>{title}</b> <span className="e-muted small">{subtitle}</span>
        </div>
        <div className="small e-sum">
          <span>
            Car <b>{sum.car.toFixed(1)} kWh</b>
          </span>
          {sum.carSolarShare != null && (
            <span>
              <b style={{ color: 'var(--e-car-solar)' }}>{Math.round(sum.carSolarShare * 100)}%</b> from solar
            </span>
          )}
          <span>
            From grid <b style={{ color: 'var(--e-house-grid)' }}>{(sum.houseGrid + sum.carGrid).toFixed(1)}</b>
          </span>
          <span>
            To grid <b style={{ color: 'var(--e-to-grid)' }}>{sum.toGrid.toFixed(1)}</b>
          </span>
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <svg ref={ref} viewBox={`0 0 ${W} ${H + PAD.t + 22}`} style={{ width: '100%', display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            <pattern id={`hatch-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--e-grid)" strokeWidth="2.5" />
            </pattern>
          </defs>
          {Array.from({ length: max / 1000 + 1 }, (_, i) => i * 1000).map((w) => (
            <g key={w}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(w)} y2={y(w)} stroke="var(--e-grid)" />
              <text x={W - PAD.r + 6} y={y(w) + 4} fontSize="11" fill="var(--e-muted)">{w / 1000} kW</text>
            </g>
          ))}
          {known.length > 1 &&
            LAYERS.map(([k, , c], i) => (
              <path key={k} d={band(known, (p) => y(edge(p, i + 1)), (p) => y(edge(p, i)))} fill={c} opacity="0.9" />
            ))}
          {unknown.length > 1 && (
            <>
              <rect x={unknown[0].x} y={PAD.t} width={x(day.now) - unknown[0].x} height={H} fill={`url(#hatch-${id})`} opacity="0.5" />
              <path d={band(unknown, (p) => y(p.car), () => y(0))} fill="var(--e-car-neutral)" opacity="0.85" />
              <path d={band(unknown, (p) => y(p.car + Math.max(0, p.fromGrid - p.car)), (p) => y(p.car))} fill="var(--e-house-grid)" opacity="0.45" />
              <path d={band(unknown, (p) => y(p.toGrid), () => y(0))} fill="var(--e-to-grid)" opacity="0.45" />
              <text x={(unknown[0].x + x(day.now)) / 2} y={PAD.t + 14} fontSize="11" textAnchor="middle" fill="var(--e-muted)">
                solar not fetched yet: only car and grid known · ↻
              </text>
            </>
          )}
          {/* Shadow start/stop markers on the shadow chart */}
          {events
            .filter((e) => e.event !== 'current')
            .map((e) => {
              const yy = y(e.event === 'start' ? e.amps * V * PHASES : 0);
              return (
                <g key={e.m} transform={`translate(${x(e.m)},${yy - 3})`}>
                  <path d={e.event === 'start' ? 'M-5,0 L5,0 L0,-8 Z' : 'M-5,-8 L5,-8 L0,0 Z'} fill={e.event === 'start' ? 'var(--e-ink)' : 'var(--e-stop)'} />
                  {e.event === 'start' && <text y={-11} fontSize="10" textAnchor="middle" fill="var(--e-ink)">start {e.amps} A</text>}
                  {e.event === 'stop' && <text y={-11} fontSize="10" textAnchor="middle" fill="var(--e-stop)">stop</text>}
                </g>
              );
            })}
          {/* Manual overrides on both charts */}
          {day.overrides.map((o) => (
            <g key={o.m} transform={`translate(${x(o.m)},${PAD.t})`}>
              <line y1={0} y2={H} stroke="var(--e-ink)" strokeDasharray="2 2" opacity="0.7" />
              <path d="M0,0 L11,4 L0,8 Z" fill="var(--e-ink)" />
              <text x={13} y={8} fontSize="10" fill="var(--e-ink)">{o.kind === 'pause' ? 'Pause' : 'Resume'} · {o.by}</text>
            </g>
          ))}
          {day.now < 1440 && <line x1={x(day.now)} x2={x(day.now)} y1={PAD.t} y2={PAD.t + H} stroke="var(--e-stop)" strokeDasharray="3 3" />}
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <text key={h} x={x(h * 60)} y={PAD.t + H + 16} fontSize="11" textAnchor="middle" fill="var(--e-muted)">{String(h).padStart(2, '0')}:00</text>
          ))}
          {hover && <line x1={x(hover.m + STEP / 2)} x2={x(hover.m + STEP / 2)} y1={PAD.t} y2={PAD.t + H} stroke="var(--e-ink)" opacity="0.5" />}
        </svg>
        {hover && hover.chart === id && b && (
          <div className="tooltip" style={{ left: Math.min(hover.left + 12, 520), top: hover.top + 12 }}>
            <b>{fmt(hover.m)}–{fmt(hover.m + STEP)}</b> · {shadow ? 'if Shadow decisions were sent' : 'really'}
            <br />
            {b.known ? (
              <>
                Solar production {kw(b.solar, 2)} · House {kw(b.house, 2)}
                <br />
                Car {kw(b.car, 2)} ({kw(b.carSolar, 2)} solar, {kw(b.carGrid, 2)} grid) · To grid {kw(b.toGrid, 2)}
              </>
            ) : (
              <>
                Car {kw(b.car, 2)} · Net power {kw(b.net, 2)} (solar not fetched yet)
              </>
            )}
            {shadow && (
              <>
                <br />
                Shadow: <b>{d.label}</b>
                {d.underlying && <> (would be: {d.underlying})</>}
                {d.limit && <> · limited by {d.limit}</>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DayTab() {
  const [di, setDi] = useState(days.length - 1);
  const [hover, setHover] = useState(null);
  const day = days[di];
  const real = buckets(day, 'real');
  const shadow = buckets(day, 'shadow');
  const peak = Math.max(...[...real, ...shadow].map((b) => (b.known ? b.house + b.car + b.toGrid : Math.max(b.fromGrid, b.car))));
  const max = Math.max(3000, Math.ceil(peak / 1000) * 1000);
  const sr = totals(real);
  const ss = totals(shadow);
  return (
    <div className="e-card e-day">
      <div className="e-legend small">
        {LAYERS.map(([k, label, c]) => (
          <span key={k}>
            <i style={{ background: c }} /> {label}
          </span>
        ))}
      </div>
      <StackChart id="real" day={day} bs={real} max={max} title="Real" subtitle="what happened" sum={sr} hover={hover} setHover={setHover} />
      <StackChart
        id="shadow"
        day={day}
        bs={shadow}
        max={max}
        title="Shadow"
        subtitle="if the Shadow decisions had been sent"
        sum={ss}
        hover={hover}
        setHover={setHover}
        shadow
      />
      <div className="e-daynav">
        <button disabled={di === 0} onClick={() => setDi(di - 1)}>‹</button>
        <span>
          <b>{day.title}</b> <span className="e-muted small">{day.date}</span>
        </span>
        <button disabled={di === days.length - 1} onClick={() => setDi(di + 1)}>›</button>
        <button disabled={di === days.length - 1} onClick={() => setDi(days.length - 1)} title="Today">⇥</button>
      </div>
    </div>
  );
}

// ---- Now tab (B, themed) ----------------------------------------------------

function Hero({ live }) {
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
    <div className={`e-card ${d.state === 'charging' ? 'e-hero-on' : ''}`}>
      <div className="small e-muted">Shadow decision · not sent to the charger</div>
      <div className="e-hero-big">{big}</div>
      <div>{why}</div>
      <div className="small e-muted" style={{ marginTop: 8 }}>
        Charger: {live.charger.state} · {live.charger.phaseSetting} · max {live.charger.maxA} A · {live.charger.mode}
      </div>
    </div>
  );
}

function Controls({ live, override, sendOverride }) {
  return (
    <div className="e-card" style={{ textAlign: 'center' }}>
      {live.canResume ? (
        <button className="btn btn-resume e-big" onClick={() => sendOverride('resume')}>▶ Resume charging</button>
      ) : (
        <button className="btn btn-pause e-big" disabled={!live.canPause} onClick={() => sendOverride('pause')}>❚❚ Pause charging</button>
      )}
      <div className="small e-muted" style={{ marginTop: 8 }}>
        {override ? (
          <span style={{ color: 'var(--e-ink)' }}>
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

function Flow({ live }) {
  const exporting = live.netW < 0;
  const node = (cx, cy, label, v, c) => (
    <g transform={`translate(${cx},${cy})`}>
      <circle r="38" fill="var(--e-card)" stroke={c} strokeWidth="3" />
      <text y="-6" textAnchor="middle" fontSize="12" fill="var(--e-muted)">{label}</text>
      <text y="12" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--e-ink)">{v}</text>
    </g>
  );
  return (
    <div className="e-card">
      <svg viewBox="0 0 320 250" style={{ width: '100%', maxWidth: 420, display: 'block', margin: '0 auto' }}>
        <defs>
          <marker id="e-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="var(--e-muted)" />
          </marker>
        </defs>
        <line x1="160" y1="80" x2="160" y2="120" stroke="var(--e-solar)" strokeWidth="4" markerEnd="url(#e-arr)" />
        <line x1="130" y1="160" x2="82" y2="190" stroke="var(--e-car-solar)" strokeWidth={live.chargerW > 0 ? 4 : 1} markerEnd="url(#e-arr)" />
        <line
          x1={exporting ? 190 : 238}
          y1={exporting ? 160 : 190}
          x2={exporting ? 238 : 190}
          y2={exporting ? 190 : 160}
          stroke={exporting ? 'var(--e-to-grid)' : 'var(--e-house-grid)'}
          strokeWidth="4"
          markerEnd="url(#e-arr)"
        />
        {node(160, 42, 'Solar', kw(live.solarW), 'var(--e-solar)')}
        <text x="205" y="40" fontSize="10" fill="var(--e-muted)">as of {fmt(live.solarAsOf)}</text>
        <text x="205" y="53" fontSize="10" fill="var(--e-link)" style={{ cursor: 'pointer' }}>↻ refresh</text>
        {node(160, 150, 'Surplus', kw(live.surplusW), 'var(--e-surplus)')}
        {node(52, 205, 'Car', kw(live.chargerW), 'var(--e-car-solar)')}
        {node(268, 205, exporting ? 'To grid' : 'From grid', kw(Math.abs(live.netW)), exporting ? 'var(--e-to-grid)' : 'var(--e-house-grid)')}
      </svg>
      <div className="small e-muted" style={{ textAlign: 'center' }}>
        P1 {ago(live.age.p1)} · Zaptec {ago(live.age.zaptec)} ·{' '}
        <span className={live.stream === 'connected' ? '' : 'stale'}>{live.stream === 'connected' ? '● live' : '● reconnecting…'}</span>
      </div>
    </div>
  );
}

function NowTab(props) {
  return (
    <div className="e-now">
      <div className="e-now-left">
        <Hero live={props.live} />
        <Controls {...props} />
      </div>
      <Flow live={props.live} />
    </div>
  );
}

// ---- page -----------------------------------------------------------------

const CSS = `
.e-root {
  --e-bg: #f4f4f6; --e-card: #ffffff; --e-ink: #1c2024; --e-muted: #6b6e78; --e-grid: #e6e6ea; --e-link: #2563eb;
  --e-house-solar: #2ba6e0; --e-house-grid: #8b2fd6; --e-car-solar: #f59e0b; --e-car-grid: #b45309; --e-car-neutral: #d97706;
  --e-to-grid: #16a34a; --e-solar: #eab308; --e-surplus: #0d9488; --e-stop: #dc2626; --e-hero-on: #e9f7ef;
  background: var(--e-bg); color: var(--e-ink); min-height: 100%; padding: 12px; padding-bottom: 80px;
}
.e-root[data-theme="dark"] {
  --e-bg: #0b0b0d; --e-card: #17171b; --e-ink: #ececf0; --e-muted: #9a9ca6; --e-grid: #2a2a30; --e-link: #7aa7ff;
  --e-house-solar: #38b6f0; --e-house-grid: #9b2ee8; --e-car-solar: #fbbf24; --e-car-grid: #d97706; --e-car-neutral: #f59e0b;
  --e-to-grid: #22c55e; --e-solar: #facc15; --e-surplus: #2dd4bf; --e-stop: #ff5d5d; --e-hero-on: #10261a;
}
@media (prefers-color-scheme: dark) {
  .e-root[data-theme="system"] {
    --e-bg: #0b0b0d; --e-card: #17171b; --e-ink: #ececf0; --e-muted: #9a9ca6; --e-grid: #2a2a30; --e-link: #7aa7ff;
    --e-house-solar: #38b6f0; --e-house-grid: #9b2ee8; --e-car-solar: #fbbf24; --e-car-grid: #d97706; --e-car-neutral: #f59e0b;
    --e-to-grid: #22c55e; --e-solar: #facc15; --e-surplus: #2dd4bf; --e-stop: #ff5d5d; --e-hero-on: #10261a;
  }
}
.e-wrap { max-width: 1200px; margin: 0 auto; }
.e-card { background: var(--e-card); border-radius: 14px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.e-hero-on { background: var(--e-hero-on); }
.e-hero-big { font-size: 30px; font-weight: 800; line-height: 1.15; margin: 6px 0; }
.e-hero-on .e-hero-big { color: var(--e-to-grid); }
.e-muted { color: var(--e-muted); }
.e-big { width: 100%; font-size: 20px; padding: 18px; }
.e-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.e-tabs { display: flex; gap: 4px; margin-left: auto; background: var(--e-card); border-radius: 999px; padding: 4px; }
.e-tabs button { border: 0; border-radius: 999px; padding: 7px 18px; background: transparent; color: var(--e-muted); font-weight: 600; }
.e-tabs button.on { background: var(--e-ink); color: var(--e-card); }
.e-now { display: grid; gap: 12px; }
.e-now-left { display: grid; gap: 12px; align-content: start; }
.e-day { display: grid; gap: 14px; }
.e-legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--e-muted); }
.e-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 10px; vertical-align: -1px; }
.e-chart-head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.e-sum { display: flex; gap: 12px; flex-wrap: wrap; color: var(--e-muted); }
.e-sum b { color: var(--e-ink); }
.e-daynav { display: flex; justify-content: center; align-items: center; gap: 16px; }
.e-daynav button { border: 0; background: transparent; color: var(--e-ink); font-size: 22px; }
.e-daynav button:disabled { color: var(--e-grid); cursor: default; }
.e-root .warn { margin-bottom: 12px; }
@container (min-width: 900px) {
  .e-now { grid-template-columns: 1.1fr 1fr; align-items: start; }
}
`;

export default function VariantE({ live, override, sendOverride }) {
  const [tab, setTab] = useParam('tab', 'now');
  const [theme] = useParam('theme', 'system');
  return (
    <div className="e-root" data-theme={theme}>
      <style>{CSS}</style>
      <div className="e-wrap">
        <header className="e-header">
          <b style={{ fontSize: 18 }}>☀︎ ChargeOnSolar</b>
          <div className="e-tabs">
            {[
              ['now', 'Now'],
              ['day', 'Day'],
            ].map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
        </header>
        {live.apmOff && (
          <div className="warn">
            ⚠ <b>APM is off.</b> Zaptec isn't protecting the main fuse. Turn load balancing back on in the Zaptec app.
          </div>
        )}
        {tab === 'day' ? <DayTab /> : <NowTab live={live} override={override} sendOverride={sendOverride} />}
      </div>
    </div>
  );
}
