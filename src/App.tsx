import { useMemo } from 'react';
import { BomPanel } from './components/BomPanel';
import { DevicePicker } from './components/DevicePicker';
import { FacePicker } from './components/FacePicker';
import { MachiningPanel } from './components/MachiningPanel';
import { PanelCanvas } from './components/PanelCanvas';
import { SettingsPanel } from './components/SettingsPanel';
import { FACE_BY_ID, FACE_LABEL } from './data/faces';
import { autoLayout } from './lib/layout';
import { useStore } from './store';

export default function App() {
  const screen = useStore((s) => s.screen);
  const face = useStore((s) => s.face);
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const items = useStore((s) => s.items);
  const pinned = useStore((s) => s.pinned);
  const backToFaces = useStore((s) => s.backToFaces);

  const layout = useMemo(
    () => autoLayout(panel, profile, face, items, pinned),
    [panel, profile, face, items, pinned],
  );

  if (screen === 'faces') {
    return (
      <div className="app">
        <header>
          <h1>Panel Studio</h1>
          <span className="tag">制御盤 盤内レイアウト &amp; BOM</span>
        </header>
        <main className="single">
          <FacePicker />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <button className="back" onClick={backToFaces}>
          ← 面を選ぶ
        </button>
        <h1>{FACE_LABEL(face)}</h1>
        <span className="tag">
          {panel.model}
          {FACE_BY_ID.get(face)?.ducts ? '' : ' — 直接取り付け'}
        </span>
      </header>
      <main>
        <aside className="left">
          <SettingsPanel />
          <DevicePicker />
        </aside>
        <PanelCanvas panel={panel} face={face} layout={layout} />
        <aside className="right">
          <BomPanel layout={layout} />
          <MachiningPanel layout={layout} />
        </aside>
      </main>
    </div>
  );
}
