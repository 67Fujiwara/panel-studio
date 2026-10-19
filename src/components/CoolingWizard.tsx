import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_COOLING_INPUT,
  ENVS,
  INPUT_RANGE,
  MATERIALS,
  METHOD_LABEL,
  MOUNTS,
  MOUNT_BY_ID,
  checkCoolingInput,
  coolingCalc,
  coolingConsts,
} from '../lib/cooling';
import type { CoolingEnv, CoolingInput, CoolingMaterial, CoolingMount } from '../lib/cooling';
import { useStore } from '../store';
import { EnvArt, MethodArt, MountArt, SizeArt, ThermoArt } from './CoolingArt';

type Step = 1 | 2 | 3 | 4 | 5;
const STEP_LABEL: Record<Step, string> = { 1: '設置条件', 2: '設置環境', 3: '盤サイズ・材質', 4: '総発熱量', 5: '結果' };

/**
 * ファン／盤クーラー選定のウィザード。
 *
 * 設置条件と環境を図カードで選び、盤サイズと総発熱量を入れると、必要風量と推奨方式が出る。
 * 盤サイズは盤サイズ画面の外形、総発熱量は部品表の発熱の合計を初期値にする（どちらも直せる）。
 * 入力は profile.cooling.input に残すので、閉じてもう一度開いても続きから見られる。
 */
export function CoolingWizard({ heatW, onClose }: { heatW: number; onClose: () => void }) {
  const panel = useStore((s) => s.panel);
  const stored = useStore((s) => s.profile.cooling?.input);
  const constsRaw = useStore((s) => s.profile.cooling?.consts);
  const consts = useMemo(() => coolingConsts(constsRaw), [constsRaw]);
  const setCooling = useStore((s) => s.setCooling);

  /** 入力。盤サイズと発熱は開くたびに設計から入れ直す（設計が進めば変わるため） */
  const [input, setInput] = useState<Partial<CoolingInput>>(() => ({
    ...DEFAULT_COOLING_INPUT,
    ...stored,
    wMm: panel.outer.w,
    hMm: panel.outer.h,
    dMm: panel.outer.d,
    qv: Math.round(heatW * 10) / 10,
  }));
  const [step, setStep] = useState<Step>(() => (stored?.mount && stored?.env ? 5 : 1));

  const update = (patch: Partial<CoolingInput>) => {
    const next = { ...input, ...patch };
    setInput(next);
    setCooling(patch);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const check = useMemo(() => checkCoolingInput(input), [input]);
  const result = useMemo(() => {
    if (!input.mount || !input.env || check.errors.length > 0) return null;
    return coolingCalc({ ...DEFAULT_COOLING_INPUT, ...input } as CoolingInput & { mount: CoolingMount; env: CoolingEnv }, consts);
  }, [input, check, consts]);

  /** そのステップへ進めるか（手前の入力が揃っているか） */
  const canGo = (s: Step): boolean => {
    if (s >= 2 && !input.mount) return false;
    if (s >= 3 && !input.env) return false;
    if (s >= 4 && (check.bad.has('wMm') || check.bad.has('hMm') || check.bad.has('dMm'))) return false;
    if (s >= 5 && check.bad.has('qv')) return false;
    return true;
  };
  const next = () => {
    if (step < 5 && canGo((step + 1) as Step)) setStep((step + 1) as Step);
  };
  const back = () => {
    if (step > 1) setStep((step - 1) as Step);
  };

  const num = (key: 'wMm' | 'hMm' | 'dMm' | 'qv' | 'ta' | 'ti', label: string, unit: string, hint?: string, step?: number) => (
    <label className={`num${check.bad.has(key) ? ' bad' : ''}`} key={key}>
      <span>
        {label}
        {hint && <em>{hint}</em>}
      </span>
      <span className="unit-wrap">
        <input
          type="number"
          value={input[key] ?? ''}
          min={INPUT_RANGE[key][0]}
          max={INPUT_RANGE[key][1]}
          step={step ?? 1}
          onChange={(e) => update({ [key]: e.target.value === '' ? NaN : Number(e.target.value) } as Partial<CoolingInput>)}
        />
        <b>{unit}</b>
      </span>
    </label>
  );

  const mountCards = (
    <div className="cards mounts">
      {MOUNTS.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`card${input.mount === m.id ? ' on' : ''}`}
          onClick={() => update({ mount: m.id })}
          aria-pressed={input.mount === m.id}
        >
          <MountArt m={m} />
          <strong>{m.label}</strong>
          <span>{m.desc}</span>
        </button>
      ))}
    </div>
  );

  const envCards = (
    <div className="cards envs">
      {ENVS.map((e) => (
        <button
          key={e.id}
          type="button"
          className={`card${input.env === e.id ? ' on' : ''}`}
          onClick={() => update({ env: e.id })}
          aria-pressed={input.env === e.id}
        >
          <EnvArt id={e.id} />
          <strong>{e.label}</strong>
          <span>{e.desc}</span>
          <em>{e.fanOk ? 'ファン方式を許可' : 'ファン非推奨（熱交換器以上）'}</em>
        </button>
      ))}
    </div>
  );

  const materialCards = (
    <div className="cards materials">
      {MATERIALS.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`card small${(input.material ?? 'steel') === m.id ? ' on' : ''}`}
          onClick={() => update({ material: m.id })}
          aria-pressed={(input.material ?? 'steel') === m.id}
        >
          <strong>{m.label}</strong>
          <span>k = {m.k} W/(m²·K)</span>
        </button>
      ))}
    </div>
  );

  const temps = (
    <div className="temps">
      <div className="grid2">
        {num('ta', '最高外気温 Ta', '℃', '夏場に盤が吸い込む空気の温度')}
        {num('ti', '盤内目標温度 Ti', '℃', '盤内機器の許容周囲温度でいちばん低い値から余裕を引いた値')}
      </div>
      <ThermoArt ta={Number(input.ta ?? 35)} ti={Number(input.ti ?? 40)} />
    </div>
  );

  const resultView = result && (
    <div className="cool-result">
      <div className={`method ${result.method}`}>
        <MethodArt method={result.method} />
        <div>
          <div className="label">推奨方式</div>
          <div className="name">{METHOD_LABEL[result.method]}</div>
          <div className="main">
            {result.method === 'none' && <>自然放熱で足ります</>}
            {result.method === 'fan' && (
              <>
                選定風量 <b>{result.selectVmin!.toFixed(2)}</b> m³/min
              </>
            )}
            {result.method === 'heat_exchanger' && (
              <>
                必要能力 <b>{result.hexCap!.toFixed(1)}</b> W/K
              </>
            )}
            {result.method === 'cooler' && (
              <>
                必要冷却能力 <b>{result.coolerCap!.toFixed(0)}</b> W
              </>
            )}
          </div>
          <div className="sub">
            {result.method === 'none' && <>余裕 = 放熱 − 発熱 = {(-result.Qnet).toFixed(1)} W</>}
            {result.method === 'fan' && (
              <>
                計算風量 {result.vh!.toFixed(1)} m³/h ＝ {result.vmin!.toFixed(2)} m³/min（余裕率 {consts.margin} を掛けた値が選定風量）
              </>
            )}
            {result.method === 'heat_exchanger' && <>逃がす熱 Qnet = {result.Qnet.toFixed(1)} W</>}
            {result.method === 'cooler' && (
              <>
                温度差 Ti − Ta = {result.dT} K。外気温が高いとクーラーの能力が下がるので、メーカーの能力曲線で確認してください
              </>
            )}
          </div>
        </div>
      </div>
      <p className="reason">{result.reason}</p>
      {result.method === 'fan' && (
        <ul className="note-list">
          <li>カタログの自由風量ではなく、<b>フィルター付きの実風量</b>で比較してください</li>
          <li>設置先の<b>電源周波数（50/60 Hz）</b>の値で確認してください</li>
        </ul>
      )}
      <details className="calc-steps">
        <summary>計算過程</summary>
        <table>
          <tbody>
            <tr>
              <td>有効放熱面積 A</td>
              <td>
                {MOUNT_BY_ID.get(input.mount!)!.formula}（W={(input.wMm! / 1000).toFixed(2)} H={(input.hMm! / 1000).toFixed(2)} D=
                {(input.dMm! / 1000).toFixed(2)} m）= <b>{result.A.toFixed(3)}</b> m²
              </td>
            </tr>
            <tr>
              <td>自然放熱 Qs</td>
              <td>
                k·A·(Ti−Ta) = {result.k} × {result.A.toFixed(3)} × {result.dT} = <b>{result.Qs.toFixed(1)}</b> W
              </td>
            </tr>
            <tr>
              <td>逃がす熱 Qnet</td>
              <td>
                Qv − Qs = {Number(input.qv).toFixed(1)} − {result.Qs.toFixed(1)} = <b>{result.Qnet.toFixed(1)}</b> W
              </td>
            </tr>
            {result.vh !== null && (
              <tr>
                <td>必要風量 Vh</td>
                <td>
                  F_AIR·Qnet／(Ti−Ta) = {consts.fAir} × {result.Qnet.toFixed(1)} ／ {result.dT} = <b>{result.vh.toFixed(1)}</b> m³/h、選定 = Vh × {consts.margin} ／ 60 ={' '}
                  <b>{result.selectVmin!.toFixed(2)}</b> m³/min
                </td>
              </tr>
            )}
            {result.hexCap !== null && (
              <tr>
                <td>熱交換器の能力</td>
                <td>
                  Qnet／(Ti−Ta) = {result.Qnet.toFixed(1)} ／ {result.dT} = <b>{result.hexCap.toFixed(1)}</b> W/K
                </td>
              </tr>
            )}
            {result.coolerCap !== null && (
              <tr>
                <td>クーラーの能力</td>
                <td>
                  Qv + k·A·(Ta−Ti) = <b>{result.coolerCap.toFixed(1)}</b> W
                </td>
              </tr>
            )}
            <tr>
              <td>定数</td>
              <td>
                F_AIR = {consts.fAir} m³·K/(W·h)、余裕率 = {consts.margin}、ファン可の最小温度差 = {consts.minDtFan} K（設定画面で変えられます）
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  );

  return (
    <div className="preview-overlay" onClick={onClose} role="dialog" aria-label="ファン／クーラーの選定">
      <div className="preview cooling" onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <strong>ファン／クーラーの選定</strong>
          <ol className="steps">
            {([1, 2, 3, 4, 5] as Step[]).map((s) => (
              <li key={s} className={`${s === step ? 'on' : ''}${canGo(s) ? '' : ' off'}`}>
                <button type="button" disabled={!canGo(s)} onClick={() => setStep(s)}>
                  {s < 5 ? `${s} ${STEP_LABEL[s]}` : STEP_LABEL[s]}
                </button>
              </li>
            ))}
          </ol>
          <button className="close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <div className="preview-body cooling-body">
          {step === 1 && (
            <>
              <h3>設置条件を選んでください</h3>
              <p className="note">壁や隣の盤に接する面は放熱しません。青い面が放熱する面、グレーがふさがっている面です。</p>
              {mountCards}
            </>
          )}
          {step === 2 && (
            <>
              <h3>設置環境と温度</h3>
              {envCards}
              {temps}
            </>
          )}
          {step === 3 && (
            <>
              <h3>盤サイズと材質</h3>
              <div className="size-row">
                <SizeArt />
                <div className="grid3">
                  {num('wMm', '幅 W', 'mm')}
                  {num('hMm', '高さ H', 'mm')}
                  {num('dMm', '奥行き D', 'mm')}
                </div>
              </div>
              <p className="note">
                盤サイズ画面の外形（{panel.outer.w}×{panel.outer.h}×D{panel.outer.d}）を入れてあります。違う盤で試すときは直してください。
              </p>
              {materialCards}
            </>
          )}
          {step === 4 && (
            <>
              <h3>総発熱量</h3>
              <div className="grid2">{num('qv', '総発熱量 Qv', 'W', '盤内機器の取説に記載の発熱量の合計。インバータは容量の約 3〜5 % が目安', 0.1)}</div>
              <p className="note">部品表の発熱の合計（{heatW.toFixed(1)} W）を入れてあります。部品に発熱を登録していないぶんは入っていません。</p>
            </>
          )}
          {step === 5 && (
            <>
              {check.warnings.length > 0 && (
                <ul className="warn-list">
                  {check.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {check.errors.length > 0 && (
                <ul className="warn-list bad">
                  {check.errors.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {resultView}
              <details className="edit-inputs" open>
                <summary>入力を直す（直すとすぐ計算し直します）</summary>
                <div className="grid3">
                  <label className="sel">
                    <span>設置条件</span>
                    <select value={input.mount ?? ''} onChange={(e) => update({ mount: e.target.value as CoolingMount })}>
                      <option value="" disabled>
                        選んでください
                      </option>
                      {MOUNTS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sel">
                    <span>設置環境</span>
                    <select value={input.env ?? ''} onChange={(e) => update({ env: e.target.value as CoolingEnv })}>
                      <option value="" disabled>
                        選んでください
                      </option>
                      {ENVS.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sel">
                    <span>材質</span>
                    <select value={input.material ?? 'steel'} onChange={(e) => update({ material: e.target.value as CoolingMaterial })}>
                      {MATERIALS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {num('wMm', '幅 W', 'mm')}
                  {num('hMm', '高さ H', 'mm')}
                  {num('dMm', '奥行き D', 'mm')}
                  {num('qv', '総発熱量 Qv', 'W', undefined, 0.1)}
                  {num('ta', '最高外気温 Ta', '℃')}
                  {num('ti', '盤内目標温度 Ti', '℃')}
                </div>
              </details>
            </>
          )}
        </div>

        <div className="preview-foot cooling-foot">
          <button type="button" onClick={back} disabled={step === 1}>
            ← 戻る
          </button>
          {step < 5 ? (
            <button type="button" className="primary" onClick={next} disabled={!canGo((step + 1) as Step)}>
              {step === 4 ? '結果を見る' : '進む →'}
            </button>
          ) : (
            <button type="button" className="primary" onClick={onClose}>
              閉じる
            </button>
          )}
          <span className="muted">Esc で閉じます。入力は案件と一緒に残ります</span>
        </div>
      </div>
    </div>
  );
}
