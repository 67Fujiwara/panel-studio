/**
 * 設定ファイルの書き出し・読み込み。
 * 共有フォルダに置いて全員で同じものを使う運用を想定している。
 */

export function downloadJson(data: unknown, fileName: string): void {
  // 整形（インデント）は付けない。外形線入りの部品表だと整形だけで 4倍（3.9MB → 16MB）になる
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** ファイル選択ダイアログを開いて JSON を読む。キャンセルなら null。 */
export function pickJson<T>(): Promise<T | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(JSON.parse(await file.text()) as T);
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

/** 複数ファイルをまとめて選んで読む。1件ずつ {名前, 中身} で返す（読めないものは null）。 */
export type PickedJson = { name: string; data: unknown | null };

export function pickJsonFiles(): Promise<PickedJson[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (files.length === 0) return resolve(null);
      const out: PickedJson[] = [];
      for (const f of files) {
        try {
          out.push({ name: f.name, data: JSON.parse(await f.text()) });
        } catch {
          out.push({ name: f.name, data: null });
        }
      }
      resolve(out);
    };
    input.click();
  });
}
