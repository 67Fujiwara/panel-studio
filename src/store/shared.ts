/** スライスが共通で使う小さな道具。 */
import type { DeviceSpec } from '../types';

let seq = 0;
/** 一意な id。接頭辞 + 時刻 + 連番 */
export const nextId = (p: string) => `${p}${Date.now().toString(36)}${++seq}`;

/** 共通の部品表と My部品をまとめた検索用 Map。 */
export function deviceLookup(devices: DeviceSpec[], myDevices: DeviceSpec[]) {
  return new Map([...devices, ...myDevices].map((d) => [d.id, d]));
}
