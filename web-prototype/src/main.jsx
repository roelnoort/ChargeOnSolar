// PROTOTYPE, throw away. Three UI variants for "UI: day timeline and live view",
// switchable via ?variant=A|B|C (bottom bar or ← →). Made-up data only.
import { createRoot } from 'react-dom/client';
import './index.css';
import { Switcher, ProtoControls, useParam, useLive, useOverride } from './shared.jsx';
import VariantA from './VariantA.jsx';
import VariantB from './VariantB.jsx';
import VariantC from './VariantC.jsx';
import VariantD from './VariantD.jsx';
import VariantE from './VariantE.jsx';

const VARIANTS = { A: VariantA, B: VariantB, C: VariantC, D: VariantD, E: VariantE };

function App() {
  const [variant, setVariant] = useParam('variant', 'E');
  const [scenario, setScenario] = useParam('scenario', 'charging');
  const [frame, setFrame] = useParam('frame', 'none');
  const live = useLive(scenario);
  const [override, sendOverride] = useOverride(setScenario);
  const V = VARIANTS[variant] ?? VariantA;
  const page = <V live={live} override={override} sendOverride={sendOverride} />;
  return (
    <>
      <ProtoControls scenario={scenario} setScenario={setScenario} frame={frame} setFrame={setFrame} />
      {frame === 'phone' ? (
        <div className="phone-frame">
          <div className="app">{page}</div>
        </div>
      ) : (
        <div className="app">{page}</div>
      )}
      <Switcher variants={Object.keys(VARIANTS)} current={variant} onChange={setVariant} />
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
