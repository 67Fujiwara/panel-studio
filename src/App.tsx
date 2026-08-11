import { useMemo } from 'react';
import { BomPanel } from './components/BomPanel';
import { DevicePicker } from './components/DevicePicker';
import { PanelCanvas } from './components/PanelCanvas';
import { SettingsPanel } from './components/SettingsPanel';
import { downloadDxf } from './lib/dxf';
import { autoLayout } from './lib/layout';
import { useStore } from './store';

export default function App() {
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const items = useStore((s) => s.items);
  const pinned = useStore((s) => s.pinned);

  const layout = useMemo(
    () => autoLayout(panel, profile, items, pinned),
    [panel, profile, items, pinned],
  );

  return (
    <div className="app">
      <header>
        <h1>Panel Studio</h1>
        <span className="tag">制御盤 盤内レイアウト &amp; BOM</span>
        <button
          className="primary"
          disabled={layout.placed.length === 0}
          onClick={() => downloadDxf(panel, layout, profile)}
        >
          DXF を書き出す
        </button>
      </header>
      <main>
        <aside className="left">
          <SettingsPanel />
          <DevicePicker />
        </aside>
        <PanelCanvas panel={panel} layout={layout} />
        <aside className="right">
          <BomPanel layout={layout} />
        </aside>
      </main>
    </div>
  );
}
