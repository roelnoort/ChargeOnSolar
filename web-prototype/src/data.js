// PROTOTYPE, throw away. Made-up data for "UI: day timeline and live view".
// One day of per-minute figures plus a rough Shadow engine that follows the
// rules in "Shadow decision rules" (5/10-min averages, 15-min min on/off,
// 15-min current hold, 1 A dead band, fuse cap). Not production logic.

export const V = 230;
export const MAIN_FUSE = 25;
export const CHARGER_MAX = 16;
export const MIN_A = 6;

// Seeded random so the picture is stable between reloads.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const hm = (h, m = 0) => h * 60 + m;
export const fmt = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/**
 * Build a day.
 * @param {object} o
 *   cloudy: 0..1, now: minute-of-day (1440 for a finished day),
 *   plugIn / unplug, pauses: [{from,to,by}], solarKnownUntil
 */
function buildDay(o) {
  const r = rng(o.seed);
  const minutes = [];
  // Clouds: a slowly varying factor.
  let cloud = 1;
  for (let m = 0; m < 1440; m++) {
    // Solar: November bell curve, sunrise ~08:20, sunset ~16:40, peak ~12:30.
    const t = (m - hm(12, 30)) / 130;
    let solar = m > hm(8, 20) && m < hm(16, 40) ? o.peak * Math.exp(-t * t) : 0;
    if (m % 7 === 0) cloud = Math.min(1, Math.max(0.25, cloud + (r() - 0.5) * 0.35 * o.cloudy + 0.04));
    solar *= 1 - o.cloudy * (1 - cloud);
    // House: base load + noise + appliances.
    let house = 320 + r() * 120;
    let houseL1 = house / 3;
    for (const a of o.appliances) {
      if (m >= a.from && m < a.to) {
        house += a.w;
        if (a.phase === 1) houseL1 += a.w;
      }
    }
    houseL1 += (house - houseL1) * 0; // other phases not tracked here
    minutes.push({ m, solarTrue: solar, house, houseL1 });
  }

  // Enphase gives 5-minute intervals; average the true curve into blocks.
  for (let b = 0; b < 1440; b += 5) {
    let sum = 0;
    for (let i = 0; i < 5; i++) sum += minutes[b + i].solarTrue;
    for (let i = 0; i < 5; i++) minutes[b + i].solar5 = sum / 5;
  }

  // Real charger (what actually happened): charges at full 16 A on 1 phase
  // whenever plugged in and not paused. That is today's reality, no automation.
  const overrides = [];
  for (const p of o.pauses) {
    overrides.push({ m: p.from, kind: 'pause', by: p.by, via: p.via, result: 'Confirmed' });
    if (p.to != null && p.resumedBy)
      overrides.push({ m: p.to, kind: 'resume', by: p.resumedBy, via: p.resumeVia, result: 'Confirmed' });
  }
  for (const x of minutes) {
    const plugged = x.m >= o.plugIn && x.m < o.unplug;
    const paused = o.pauses.some((p) => x.m >= p.from && (p.to == null || x.m < p.to));
    const full = o.carFullAt != null && x.m >= o.carFullAt;
    x.plugged = plugged;
    x.paused = plugged && paused;
    x.charger = plugged && !paused && !full ? CHARGER_MAX * V * (0.97 + r() * 0.02) : 0;
    x.carFull = plugged && full;
    x.net = x.house + x.charger - x.solarTrue; // + import, − export
    x.surplus = x.charger - x.net; // = solar − house
    x.fuseHeadroom = MAIN_FUSE - x.houseL1 / V;
  }

  const decisions = runShadow(minutes, o);
  return { ...o, minutes, decisions, overrides };
}

/** Rough Shadow engine, Solar only, 1 phase. */
function runShadow(minutes, o) {
  const out = [];
  let on = false;
  let amps = 0;
  let lastSwitch = -9999;
  let lastCurrentChange = -9999;
  let switches = 0;
  let firstStartDone = false;
  const avg = (m, n) => {
    let s = 0;
    let c = 0;
    for (let i = Math.max(0, m - n + 1); i <= m; i++) {
      s += minutes[i].surplus;
      c++;
    }
    return s / c;
  };
  for (const x of minutes) {
    const m = x.m;
    if (!x.plugged) {
      if (on) on = false;
      switches = 0;
      firstStartDone = false;
      out.push({ m, state: 'no-car', amps: 0, label: 'No car' });
      continue;
    }
    if (x.carFull) {
      out.push({ m, state: 'full', amps: 0, label: 'Car not accepting charge' });
      continue;
    }
    const a5 = avg(m, 5);
    const a10 = avg(m, 10);
    const fuse = Math.floor(x.fuseHeadroom);
    const cap = Math.min(CHARGER_MAX, fuse);
    const startW = MIN_A * V;
    let event = null;
    let reason = '';
    if (!on) {
      const offLongEnough = !firstStartDone || m - lastSwitch >= 15;
      if (a5 >= startW && offLongEnough && 20 - switches >= 2 && fuse >= MIN_A) {
        on = true;
        firstStartDone = true;
        lastSwitch = m;
        switches++;
        amps = Math.max(MIN_A, Math.min(cap, Math.floor(a5 / V)));
        lastCurrentChange = m;
        event = 'start';
      } else {
        reason = a5 < startW ? 'Surplus below 6 A' : !offLongEnough ? 'Minimum off-time' : 'Fuse headroom';
      }
    } else {
      if (fuse < MIN_A) {
        on = false;
        lastSwitch = m;
        switches++;
        event = 'stop';
        reason = 'Fuse headroom below 6 A';
      } else if (a10 < startW && m - lastSwitch >= 15) {
        on = false;
        lastSwitch = m;
        switches++;
        event = 'stop';
        reason = 'Surplus below 6 A';
      } else {
        const want = Math.max(MIN_A, Math.min(cap, Math.floor(a5 / V)));
        if (m - lastCurrentChange >= 15 && Math.abs(want - amps) >= 1) {
          amps = want;
          lastCurrentChange = m;
          event = 'current';
        }
        // A sudden fuse limit wins over the hold.
        if (amps > cap) {
          amps = cap;
          lastCurrentChange = m;
          event = 'current';
        }
      }
    }
    const limit = !on ? null : amps >= cap && cap === fuse && fuse < CHARGER_MAX ? 'Fuse headroom' : amps >= CHARGER_MAX ? 'Charger max' : 'Surplus';
    const d = {
      m,
      state: on ? 'charging' : 'stopped',
      amps: on ? amps : 0,
      limit,
      event,
      reason,
      a5,
      a10,
      switchesLeft: 20 - switches,
      label: on ? `Charge at ${amps} A` : 'Stop',
    };
    if (x.paused) {
      // The pause wins; underlying decision is still shown greyed out.
      out.push({ ...d, underlying: d.label, state: 'paused', label: 'Paused by you' });
    } else out.push(d);
  }
  return out;
}

// --- The two days in the prototype ---------------------------------------

export const NOW = hm(13, 20);

export const today = buildDay({
  key: 'today',
  title: 'Today',
  date: 'Sat 21 Nov',
  seed: 42,
  peak: 4300,
  cloudy: 0.6,
  now: NOW,
  plugIn: hm(9, 50),
  unplug: 1440,
  carFullAt: null,
  solarKnownUntil: hm(12, 5),
  appliances: [
    { from: hm(7, 10), to: hm(7, 16), w: 2100, phase: 1 }, // kettle
    { from: hm(8, 0), to: hm(8, 40), w: 1800, phase: 2 }, // washing machine
    { from: hm(12, 0), to: hm(12, 25), w: 3200, phase: 1 }, // oven
    { from: hm(12, 40), to: hm(13, 5), w: 2300, phase: 1 }, // dishwasher heating
  ],
  pauses: [{ from: hm(11, 2), to: hm(11, 48), by: 'Roel', via: 'ChargeOnSolar', resumedBy: 'Roel', resumeVia: 'ChargeOnSolar' }],
});

export const yesterday = buildDay({
  key: 'yesterday',
  title: 'Yesterday',
  date: 'Fri 20 Nov',
  seed: 7,
  peak: 3600,
  cloudy: 0.9,
  now: 1440,
  plugIn: hm(8, 30),
  unplug: hm(17, 45),
  carFullAt: hm(15, 20),
  solarKnownUntil: 1440,
  appliances: [
    { from: hm(18, 0), to: hm(18, 40), w: 3000, phase: 1 },
    { from: hm(10, 0), to: hm(10, 50), w: 1900, phase: 2 },
  ],
  pauses: [{ from: hm(9, 20), to: hm(10, 5), by: 'Zaptec app', via: 'Zaptec app', resumedBy: 'Roel', resumeVia: 'ChargeOnSolar' }],
});

export const days = [yesterday, today];

/** Shadow decision events (start/stop/current change) up to `until`. */
export function decisionEvents(day, until = day.now) {
  return day.decisions.filter((d) => d.m < until && d.event);
}

// --- Live state (what the SSE snapshot would carry) ----------------------

export const SCENARIOS = {
  charging: 'Charging, Shadow says charge',
  pausedByYou: 'Paused by you (ChargeOnSolar)',
  external: 'External pause (Zaptec app)',
  noCar: 'No car connected',
  apmOff: 'APM is off (warning)',
  stale: 'Stream lost / stale P1',
};

export function liveSnapshot(scenario, jitter) {
  const x = today.minutes[NOW];
  const d = today.decisions[NOW];
  const base = {
    netW: x.net + jitter * 60,
    chargerW: x.charger,
    surplusW: x.surplus + jitter * 60 - jitter * 60 * 0,
    solarW: today.minutes[today.solarKnownUntil].solar5,
    solarAsOf: today.solarKnownUntil,
    fuseHeadroomA: x.fuseHeadroom,
    phases: [x.houseL1 / V + (x.charger / V), (x.house - x.houseL1) / 2 / V, (x.house - x.houseL1) / 2 / V].map((a) => a),
    decision: d,
    charger: { state: 'Charging', phaseSetting: '1 phase', maxA: CHARGER_MAX, mode: 'APM on' },
    switchesLeft: 14,
    canPause: true,
    canResume: false,
    pauseReason: '',
    resumeReason: '',
    stream: 'connected',
    age: { p1: 1, zaptec: 22, enphase: (NOW - today.solarKnownUntil) * 60 },
    apmOff: false,
  };
  switch (scenario) {
    case 'pausedByYou':
      return {
        ...base,
        chargerW: 0,
        netW: base.netW - x.charger,
        charger: { ...base.charger, state: 'Paused by you' },
        decision: { ...d, state: 'paused', underlying: d.label, label: 'Paused by you' },
        canPause: false,
        pauseReason: 'Not charging',
        canResume: true,
      };
    case 'external':
      return {
        ...base,
        chargerW: 0,
        netW: base.netW - x.charger,
        charger: { ...base.charger, state: 'Paused in Zaptec app' },
        decision: { ...d, state: 'paused', underlying: d.label, label: 'Paused (External pause)' },
        canPause: false,
        pauseReason: 'Not charging',
        canResume: true,
      };
    case 'noCar':
      return {
        ...base,
        chargerW: 0,
        netW: base.netW - x.charger,
        charger: { ...base.charger, state: 'No car' },
        decision: { m: NOW, state: 'no-car', amps: 0, label: 'No car' },
        canPause: false,
        pauseReason: 'No car connected',
        canResume: false,
      };
    case 'apmOff':
      return { ...base, apmOff: true, charger: { ...base.charger, mode: 'APM off' } };
    case 'stale':
      return { ...base, stream: 'reconnecting', age: { p1: 74, zaptec: 95, enphase: base.age.enphase } };
    default:
      return base;
  }
}

export const kw = (w, digits = 1) => `${(w / 1000).toFixed(digits)} kW`;
export const ago = (s) =>
  s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`;
