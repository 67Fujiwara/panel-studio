import { useMemo } from 'react';
import { ConfigScreen } from './components/ConfigScreen';
import { CoordPanel } from './components/CoordPanel';
import { DevicePicker } from './components/DevicePicker';
import { FacePicker } from './components/FacePicker';
import { MachiningPanel } from './components/MachiningPanel';
import { MyConfigScreen } from './components/MyConfigScreen';
import { PanelCanvas } from './components/PanelCanvas';
import { ProjectsScreen } from './components/ProjectsScreen';
import { SettingsPanel } from './components/SettingsPanel';
import { AiLayoutPanel } from './components/AiLayoutPanel';
import { StartScreen } from './components/StartScreen';
import { FACE_BY_ID, FACE_LABEL } from './data/faces';
import { autoLayout } from './lib/layout';
import { deviceLookup, useStore, type Screen } from './store';

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
  const newDesign = useStore((s) => s.newDesign);
  const removedDucts = useStore((s) => s.removedDucts);

  const lookup = useMemo(() => deviceLookup(devices, myDevices), [devices, myDevices]);
  const layout = useMemo(
    () => autoLayout(panel, profile, face, items, pinned, lookup, removedDucts[face] ?? []),
    [panel, profile, face, items, pinned, lookup, removedDucts],
  );

  const hasDucts = FACE_BY_ID.get(face)?.ducts ?? false;

  /**
   * 新規作成。作りかけがあるときだけ確かめる。
   * 押し間違いで机の上が消えるのを防ぎつつ、白紙のときは黙って進む。
   */
  const startNew = () => {
    const s = useStore.getState();
    const dirty = s.items.length > 0 || s.machining.length > 0;
    if (dirty && !window.confirm('いまの設計を消して新規作成します。よろしいですか？')) return;
    newDesign();
  };

  // 画面の移動はタブ。新規作成だけは移動ではなく操作なのでボタンで分ける
  const tab = (id: Screen, label: string) => (
    <button
      className={`navtab${screen === id ? ' on' : ''}`}
      aria-current={screen === id ? 'page' : undefined}
      onClick={() => go(id)}
    >
      {label}
    </button>
  );

  const nav = (
    <nav className="nav">
      {tab('start', '盤サイズ')}
      {tab('faces', '面選択')}
      {tab('config', '設定')}
      {tab('myconfig', 'My部品')}
      {tab('projects', '完了案件')}
      <button className="navbtn primary" onClick={startNew}>
        ＋ 新規作成
      </button>
    </nav>
  );

  if (screen === 'layout') {
    return (
      <div className="app">
        <header>
          <button className="back" onClick={() => go('faces')}>
            ← 面選択
          </button>
          <h1>{FACE_LABEL(face)}</h1>
          <span className="tag">
            {panel.model || '型式未設定'}
            {hasDucts ? '' : ' — 直接取り付け'}
          </span>
          {nav}
        </header>
        <main>
          <aside className="left">
            {/*
              中板はダクトとクリアランス、それ以外は座標。使用部品は共通。
              調整はダクト単位なので、図に出ている横ダクトの本数をそのまま渡す
            */}
            {hasDucts && <AiLayoutPanel layout={layout} devices={lookup} />}
            {hasDucts ? (
              <SettingsPanel
                ductCount={
                  new Set(
                    layout.ducts.filter((d) => !d.removed && d.w >= d.h).map((d) => d.id),
                  ).size
                }
              />
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
        {screen === 'projects' && <ProjectsScreen />}
      </main>
    </div>
  );
}
