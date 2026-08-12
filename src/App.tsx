import { useMemo } from 'react';
import { ConfigScreen } from './components/ConfigScreen';
import { CoordPanel } from './components/CoordPanel';
import { DevicePicker } from './components/DevicePicker';
import { FacePicker } from './components/FacePicker';
import { MachiningPanel } from './components/MachiningPanel';
import { MyConfigScreen } from './components/MyConfigScreen';
import { PanelCanvas } from './components/PanelCanvas';
import { SettingsPanel } from './components/SettingsPanel';
import { StartScreen } from './components/StartScreen';
import { FACE_BY_ID, FACE_LABEL } from './data/faces';
import { autoLayout } from './lib/layout';
import { deviceLookup, useStore } from './store';

export default function App() {
  const screen = useStore((s) => s.screen);
  const face = useStore((s) => s.face);
  const panel = useStore((s) => s.panel);
  const profile = useStore((s) => s.profile);
  const items = useStore((s) => s.items);
  const pinned = useStore((s) => s.pinned);
  const categories = useStore((s) => s.categories);
  const devices = useStore((s) => s.devices);
  const myDevices = useStore((s) => s.myDevices);
  const go = useStore((s) => s.go);
  const removedDucts = useStore((s) => s.removedDucts);

  const lookup = useMemo(() => deviceLookup(devices, myDevices), [devices, myDevices]);
  const layout = useMemo(
    () => autoLayout(panel, profile, face, items, pinned, lookup, removedDucts[face] ?? []),
    [panel, profile, face, items, pinned, lookup, removedDucts],
  );

  const hasDucts = FACE_BY_ID.get(face)?.ducts ?? false;

  const nav = (
    <nav className="nav">
      <button onClick={() => go('start')}>盤サイズ</button>
      <button onClick={() => go('faces')}>面を選ぶ</button>
      <button onClick={() => go('config')}>設定</button>
      <button onClick={() => go('myconfig')}>My部品</button>
    </nav>
  );

  if (screen === 'layout') {
    return (
      <div className="app">
        <header>
          <button className="back" onClick={() => go('faces')}>
            ← 面を選ぶ
          </button>
          <h1>{FACE_LABEL(face)}</h1>
          <span className="tag">
            {panel.model}
            {hasDucts ? '' : ' — 直接取り付け'}
          </span>
          {nav}
        </header>
        <main>
          <aside className="left">
            {/* 中板はダクトとクリアランス、それ以外は座標。使用部品は共通 */}
            {hasDucts ? (
              <SettingsPanel rowCount={layout.rows.length} />
            ) : (
              <CoordPanel layout={layout} devices={lookup} />
            )}
            <DevicePicker />
          </aside>
          <PanelCanvas
            panel={panel}
            face={face}
            layout={layout}
            devices={lookup}
            categories={categories}
          />
          <aside className="right">
            <MachiningPanel layout={layout} devices={lookup} />
          </aside>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>Panel Studio</h1>
        <span className="tag">制御盤 盤内レイアウト &amp; BOM</span>
        {nav}
      </header>
      <main className="single">
        {screen === 'start' && <StartScreen />}
        {screen === 'faces' && <FacePicker />}
        {screen === 'config' && <ConfigScreen />}
        {screen === 'myconfig' && <MyConfigScreen />}
      </main>
    </div>
  );
}
