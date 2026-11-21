// PROTOTYPE, throw away.
// Variant C, "Lanes + log": built for the Monitoring phase's question
// "would the Shadow decisions have been right?". The day is stacked lanes on one
// time axis: Surplus against the 6 A start line, Shadow decision segments
// labelled with amps, what the real charger did, and an events lane. Next to it a
// chronological log. Live figures are a thin ticker; Pause/Resume is a sticky
// bar on the phone.
// Answers the open questions as: Charger power is its own lane (real vs Shadow);
// earlier days via date chips; Manual overrides are flags in the events lane and
// rows in the log.
import { useState } from 'react';
import { days, fmt, kw, ago, decisionEvents, MIN_A, V, CHARGER_MAX } from './data.js';

const X0 = 7 * 60;
const X1 = 19 * 60;

function segments(list, key) {
  const out = [];
  for (const d of list) {
    const k = key(d);
    const last = out.at(-1);
    if (last && last.k === k && last.to === d.m) last.to = d.m + 1;
    else out.push({ k, from: d.m, to: d.m + 1, d });
  }
  return out;
}

function Lanes({ day, sel, setSel }) {
  const W = 1000;
  const L = 96; // label column
  const x = (m) => L + ((m - X0) / (X1 - X0)) * (W - L - 8);
  const end = Math.min(X1, day.now);
  const mins = day.minutes.filter((p) => p.m >= X0 && p.m < end);
  const decs = day.decisions.filter((d) => d.m >= X0 && d.m < end);
  const lanes = { power: [8, 110], shadow: [128, 34], real: [172, 34], events: [216, 30] };
  const yp = (w) => lanes.power[0] + lanes.power[1] - ((Math.max(-500, w) + 500) / 5000) * lanes.power[1];

  const shadowSegs = segments(decs, (d) => `${d.state}:${d.amps}`);
  const realSegs = segments(
    mins.map((p) => ({ m: p.m, p })),
    ({ p }) => (!p.plugged ? 'none' : p.paused ? 'paused' : p.carFull ? 'full' : p.charger > 0 ? 'charging' : 'idle'),
  );
  const shadowFill = (s) =>
    s.d.state === 'charging' ? `rgba(11,122,62,${0.3 + (s.d.amps / CHARGER_MAX) * 0.7})` : s.d.state === 'paused' ? '#d4d4da' : s.d.state === 'no-car' ? 'transparent' : '#ececf0';
  const realFill = { charging: 'rgba(110,86,207,.75)', paused: '#d4d4da', full: '#c7d2fe', idle: '#ececf0', none: 'transparent' };
  const LaneLabel = ({ y, h, t, sub }) => (
    <g>
      <text x={4} y={y + h / 2} fontSize="12" fontWeight="600" fill="#333">{t}</text>
      {sub && <text x={4} y={y + h / 2 + 13} fontSize="10" fill="#888">{sub}</text>}
    </g>
  );
  return (
    <svg
      viewBox={`0 0 ${W} 270`}
      style={{ width: '100%', display: 'block' }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W;
        const m = Math.round(X0 + ((px - L) / (W - L - 8)) * (X1 - X0));
        setSel(m >= X0 && m < end ? m : null);
      }}
    >
      <LaneLabel y={lanes.power[0]} h={lanes.power[1]} t="Power" sub="kW" />
      <LaneLabel y={lanes.shadow[0]} h={lanes.shadow[1]} t="Shadow" sub="decision" />
      <LaneLabel y={lanes.real[0]} h={lanes.real[1]} t="Charger" sub="real" />
      <LaneLabel y={lanes.events[0]} h={lanes.events[1]} t="Events" />
      {/* power lane */}
      <rect x={L} y={lanes.power[0]} width={W - L - 8} height={lanes.power[1]} fill="#fafafa" />
      <line x1={L} x2={W - 8} y1={yp(0)} y2={yp(0)} stroke="#ccc" />
      <line x1={L} x2={W - 8} y1={yp(MIN_A * V)} y2={yp(MIN_A * V)} stroke="var(--surplus)" strokeDasharray="4 3" />
      <text x={W - 10} y={yp(MIN_A * V) - 3} fontSize="10" textAnchor="end" fill="var(--surplus)">start line 6 A ≈ 1.38 kW</text>
      <path
        d={mins.filter((p) => p.m <= day.solarKnownUntil).map((p, i) => `${i ? 'L' : 'M'}${x(p.m)},${yp(p.solar5)}`).join(' ')}
        fill="none"
        stroke="var(--solar)"
        strokeDasharray="2 2"
      />
      <path d={mins.map((p, i) => `${i ? 'L' : 'M'}${x(p.m)},${yp(p.surplus)}`).join(' ')} fill="none" stroke="var(--surplus)" strokeWidth="1.6" />
      {/* shadow lane */}
      {shadowSegs.map((s) => (
        <g key={s.from}>
          <rect x={x(s.from)} y={lanes.shadow[0]} width={x(s.to) - x(s.from)} height={lanes.shadow[1]} fill={shadowFill(s)} />
          {s.d.state === 'charging' && x(s.to) - x(s.from) > 22 && (
            <text x={(x(s.from) + x(s.to)) / 2} y={lanes.shadow[0] + 21} fontSize="11" textAnchor="middle" fill="#fff" fontWeight="700">{s.d.amps} A</text>
          )}
          {s.d.state === 'paused' && x(s.to) - x(s.from) > 40 && (
            <text x={(x(s.from) + x(s.to)) / 2} y={lanes.shadow[0] + 21} fontSize="10" textAnchor="middle" fill="#555">paused</text>
          )}
        </g>
      ))}
      {/* real lane */}
      {realSegs.map((s) => (
        <g key={s.from}>
          <rect x={x(s.from)} y={lanes.real[0]} width={x(s.to) - x(s.from)} height={lanes.real[1]} fill={realFill[s.k]} />
          {s.k === 'charging' && x(s.to) - x(s.from) > 40 && (
            <text x={(x(s.from) + x(s.to)) / 2} y={lanes.real[0] + 21} fontSize="11" textAnchor="middle" fill="#fff" fontWeight="700">16 A</text>
          )}
          {s.k === 'full' && x(s.to) - x(s.from) > 40 && (
            <text x={(x(s.from) + x(s.to)) / 2} y={lanes.real[0] + 21} fontSize="10" textAnchor="middle" fill="#333">car full</text>
          )}
        </g>
      ))}
      {/* events lane */}
      {day.overrides.map((o) => (
        <g key={o.m} transform={`translate(${x(o.m)},${lanes.events[0] + 4})`}>
          <line y1={0} y2={22} stroke="#1c2024" />
          <path d="M0,0 L11,4 L0,8 Z" fill="#1c2024" />
          <text x={2} y={21} fontSize="10">{o.kind === 'pause' ? '❚❚' : '▶'}</text>
        </g>
      ))}
      {day.key === 'today' && (
        <g transform={`translate(${x(day.solarKnownUntil)},${lanes.events[0] + 4})`}>
          <text fontSize="13" y={16} textAnchor="middle" fill="#a07400">☀︎</text>
          <text fontSize="9" y={26} textAnchor="middle" fill="#a07400">solar fetched</text>
        </g>
      )}
      {/* axis, now, selection */}
      {Array.from({ length: 13 }, (_, i) => X0 + i * 60).map((m) => (
        <g key={m}>
          <line x1={x(m)} x2={x(m)} y1={8} y2={250} stroke="#000" opacity="0.04" />
          <text x={x(m)} y={264} fontSize="10" textAnchor="middle" fill="#888">{fmt(m).slice(0, 2)}</text>
        </g>
      ))}
      {day.now < 1440 && <line x1={x(day.now)} x2={x(day.now)} y1={8} y2={250} stroke="#e5484d" strokeDasharray="3 3" />}
      {sel != null && <line x1={x(sel)} x2={x(sel)} y1={8} y2={250} stroke="#000" strokeWidth="1.5" />}
    </svg>
  );
}

function Log({ day, sel, setSel }) {
  const rows = [
    ...decisionEvents(day).map((d) => ({
      m: d.m,
      tag: 'Shadow',
      text:
        d.event === 'start'
          ? `Start at ${d.amps} A · 5-min Surplus ${kw(d.a5, 2)}`
          : d.event === 'stop'
            ? `Stop · ${d.reason} · 10-min Surplus ${kw(d.a10, 2)}`
            : `Current → ${d.amps} A · limit ${d.limit}`,
    })),
    ...day.overrides.map((o) => ({ m: o.m, tag: 'Override', text: `${o.kind === 'pause' ? 'Pause' : 'Resume'} by ${o.by} (${o.via}) · ${o.result}` })),
    ...(day.key === 'today' ? [{ m: day.solarKnownUntil + 5, tag: 'Solar', text: 'Enphase refreshed (on demand)' }] : []),
    { m: day.plugIn, tag: 'Car', text: 'Plugged in, charge session started' },
    ...(day.unplug < 1440 ? [{ m: day.unplug, tag: 'Car', text: 'Unplugged' }] : []),
  ].sort((a, b) => b.m - a.m);
  const tagColor = { Shadow: '#0b7a3e', Override: '#1c2024', Solar: '#a07400', Car: '#6e56cf' };
  return (
    <div className="card c-log">
      <b>Log · {day.title}</b>
      <div style={{ overflow: 'auto', maxHeight: 420, marginTop: 6 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            onClick={() => setSel(r.m)}
            style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13, cursor: 'pointer', background: sel === r.m ? '#f3f3ff' : undefined }}
          >
            <span className="muted" style={{ width: 40 }}>{fmt(r.m)}</span>
            <span className="pill" style={{ background: tagColor[r.tag], color: '#fff', height: 18 }}>{r.tag}</span>
            <span>{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Ticker({ live }) {
  const items = [
    ['Surplus', kw(live.surplusW), ago(live.age.p1), live.age.p1 > 60],
    ['Net power', kw(live.netW), ago(live.age.p1), live.age.p1 > 60],
    ['Charger power', kw(live.chargerW), ago(live.age.zaptec), live.age.zaptec > 60],
    ['Solar production', kw(live.solarW), `as of ${fmt(live.solarAsOf)} ↻`, false],
    ['Fuse headroom', `${Math.floor(live.fuseHeadroomA)} A`, 'busiest phase', false],
  ];
  return (
    <div className="c-ticker">
      <span className={live.stream === 'connected' ? '' : 'stale'} style={{ fontSize: 12 }}>● {live.stream === 'connected' ? 'live' : 'reconnecting'}</span>
      {items.map(([l, v, s, stale]) => (
        <div key={l}>
          <div className="small muted">{l}</div>
          <b>{v}</b> <span className={stale ? 'small stale' : 'small muted'}>{s}</span>
        </div>
      ))}
    </div>
  );
}

function ControlBar({ live, override, sendOverride }) {
  const d = live.decision;
  return (
    <div className="c-controls">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="small muted">Shadow now</div>
        <b>{d.label}</b>
        {d.limit && <span className="small"> · {d.limit}</span>}
        {d.underlying && <span className="small muted"> · else {d.underlying}</span>}
      </div>
      <div style={{ textAlign: 'right' }}>
        {live.canResume ? (
          <button className="btn btn-resume" onClick={() => sendOverride('resume')}>Resume</button>
        ) : (
          <button className="btn btn-pause" disabled={!live.canPause} onClick={() => sendOverride('pause')}>Pause</button>
        )}
        <div className="small muted">{override ? override.step : live.canPause || live.canResume ? `${live.switchesLeft}/20 switches` : live.pauseReason}</div>
      </div>
    </div>
  );
}

export default function VariantC({ live, override, sendOverride }) {
  const [di, setDi] = useState(days.length - 1);
  const [sel, setSel] = useState(null);
  const day = days[di];
  const sd = sel != null ? day.decisions[sel] : null;
  const sp = sel != null ? day.minutes[sel] : null;
  return (
    <div>
      <style>{`
        .c-ticker { display: flex; gap: 18px; overflow-x: auto; padding: 10px 12px; background: #1c2024; color: #fff; align-items: center; white-space: nowrap; }
        .c-ticker .muted { color: #9a9ca6; }
        .c-body { padding: 12px; display: grid; gap: 12px; }
        .c-controls { position: sticky; bottom: 0; display: flex; gap: 12px; align-items: center; padding: 10px 12px 64px; background: #fff; border-top: 1px solid #ddd; }
        .c-lanes-scroll { overflow-x: auto; }
        .c-lanes-scroll svg { min-width: 760px; }
        @container (min-width: 900px) {
          .c-body { grid-template-columns: 1fr 360px; align-items: start; }
          .c-controls { position: static; border: 0; padding: 0 12px; background: transparent; grid-column: 1 / span 2; }
          .c-lanes-scroll svg { min-width: 0; }
        }
      `}</style>
      <Ticker live={live} />
      {live.apmOff && <div className="warn" style={{ margin: 12 }}>⚠ APM is off: Zaptec isn't protecting the main fuse. Turn it back on in the Zaptec app.</div>}
      <div className="c-body">
        <div className="card">
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {days.map((d, i) => (
              <button key={d.key} className="pill" onClick={() => { setDi(i); setSel(null); }} style={{ border: 0, padding: '5px 10px', background: i === di ? '#1c2024' : '#ececf0', color: i === di ? '#fff' : '#333' }}>
                {d.title} · {d.date}
              </button>
            ))}
            <span className="small muted" style={{ marginLeft: 'auto' }}>click the lanes or a log row</span>
          </div>
          <div className="c-lanes-scroll">
            <Lanes day={day} sel={sel} setSel={setSel} />
          </div>
          <div className="small" style={{ minHeight: 36, marginTop: 4 }}>
            {sd ? (
              <>
                <b>{fmt(sel)}</b> · Shadow: <b>{sd.label}</b>
                {sd.underlying && ` (else ${sd.underlying})`}
                {sd.limit && ` · ${sd.limit}`}
                {sd.reason && ` · ${sd.reason}`} · Surplus {kw(sp.surplus)} · Net power {kw(sp.net)} · Charger power {kw(sp.charger)}
                {sel <= day.solarKnownUntil && ` · Solar production ${kw(sp.solar5)}`}
              </>
            ) : (
              <span className="muted">
                Power lane: <span style={{ color: 'var(--surplus)' }}>Surplus</span> (live, drives decisions), <span style={{ color: '#a07400' }}>Solar production</span> dotted (5-min, lags). Shadow lane: darker green = more amps.
                Charger lane: what really happened.
              </span>
            )}
          </div>
        </div>
        <Log day={day} sel={sel} setSel={setSel} />
        {di === days.length - 1 && <ControlBar live={live} override={override} sendOverride={sendOverride} />}
      </div>
    </div>
  );
}
