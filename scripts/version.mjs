// タイトル横に出すバージョン（V91 のような整数）を src/version.ts に書く。
// git のコミット数から作る。ビルドはコミットの前に行うので、いま作るコミットのぶん +1 する。
// 手で番号を上げ忘れることがなく、共有フォルダの HTML がどの版かを見ただけで言える。
// git が無い環境（zip で展開したソースなど）では 0 にする。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let n = 0;
try {
  n = Number(execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) + 1;
} catch {
  n = 0;
}
const root = path.resolve(new URL('..', import.meta.url).pathname);
const file = path.join(root, 'src/version.ts');
const text = `// scripts/version.mjs が書く。手で直さない（git のコミット数 +1。git が無ければ 0）\nexport const APP_VERSION = ${n};\n`;
if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
console.log(`version: V${n}`);
