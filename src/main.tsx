import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startPersisting } from './lib/persist';
import './index.css';

/*
 * 残してある部品表・設定を**戻してから**描く。
 * 先に描くと初期の部品表が一瞬見えて、その間に触った操作が残す先を壊しかねない。
 * 戻す側は数秒で切り上げるので、IndexedDB が固まっていても画面は出る。
 */
void startPersisting().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
