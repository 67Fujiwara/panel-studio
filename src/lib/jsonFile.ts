/**
 * 設定ファイルの書き出し・読み込み。
 * 共有フォルダに置いて全員で同じものを使う運用を想定している。
 */

export function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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

/** 選んだ1ファイルぶんの結果。data が null なら JSON として読めなかった。 */
export type PickedJson = { name: string; data: unknown | null };

/**
 * ファイルをまとめて選んで JSON を読む。キャンセルなら null。
 * どのファイルが読めなかったかを呼び出し側で知らせられるよう、名前つきで返す。
 */
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
