// PROTOTYPE, throw away. Switcher bar, prototype controls and the fake live hook.
import { useEffect, useState, useCallback } from 'react';
import { SCENARIOS, liveSnapshot } from './data.js';

export function useParam(name, fallback) {
  const get = () => new URLSearchParams(location.search).get(name) ?? fallback;
  const [v, setV] = useState(get);
  useEffect(() => {
    const on = () => setV(get());
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  const set = useCallback(
    (nv) => {
      const p = new URLSearchParams(location.search);
      p.set(name, nv);
      history.replaceState(null, '', `?${p}`);
      setV(nv);
      dispatchEvent(new PopStateEvent('popstate'));
    },
    [name],
  );
  return [v, set];
}

/** Fake SSE: a new snapshot every second with a bit of jitter on P1 figures. */
export function useLive(scenario) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const jitter = Math.sin(tick * 1.7) + Math.sin(tick * 0.4) * 0.6;
  return liveSnapshot(scenario, jitter);
}

/** Fake Manual override: Sending → Accepted → Confirmed, then flips the scenario. */
export function useOverride(setScenario) {
  const [status, setStatus] = useState(null); // {kind, step}
  const send = (kind) => {
    setStatus({ kind, step: 'Sending' });
    setTimeout(() => setStatus({ kind, step: 'Accepted' }), 700);
    setTimeout(() => {
      setStatus({ kind, step: 'Confirmed' });
      setScenario(kind === 'pause' ? 'pausedByYou' : 'charging');
    }, 2600);
    setTimeout(() => setStatus(null), 5000);
  };
  return [status, send];
}

const VARIANT_NAMES = { A: 'Timeline first', B: 'Now first', C: 'Lanes + log' };

export function Switcher({ variants, current, onChange }) {
  const i = variants.indexOf(current);
  const go = (d) => onChange(variants[(i + d + variants.length) % variants.length]);
  useEffect(() => {
    const on = (e) => {
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });
  if (import.meta.env.PROD) return null;
  return (
    <div className="proto-bar">
      <button onClick={() => go(-1)}>←</button>
      <span>
        {current} ({VARIANT_NAMES[current]})
      </span>
      <button onClick={() => go(1)}>→</button>
    </div>
  );
}

export function ProtoControls({ scenario, setScenario, frame, setFrame }) {
  if (import.meta.env.PROD) return null;
  return (
    <div className="proto-controls">
      <b>PROTOTYPE</b> · made-up data ·{' '}
      <label>
        Now:{' '}
        <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
          {Object.entries(SCENARIOS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        <input type="checkbox" checked={frame === 'phone'} onChange={(e) => setFrame(e.target.checked ? 'phone' : 'none')} />{' '}
        phone frame
      </label>
    </div>
  );
}
