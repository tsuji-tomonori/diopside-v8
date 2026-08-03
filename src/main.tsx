import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import { App } from './App.tsx';
import { DeviceStore } from './data/deviceStore.ts';
import { loadPublicBundle, PublicDataError, type PublicBundle } from './data/loadPublicData.ts';
import './styles.css';

function Bootstrap(): React.JSX.Element {
  const store = useMemo(() => new DeviceStore(), []);
  const [bundle, setBundle] = useState<PublicBundle | null>(null);
  const [failure, setFailure] = useState<PublicDataError | null>(null);
  useEffect(() => {
    void loadPublicBundle(store).then(setBundle).catch((error: unknown) => {
      setFailure(error instanceof PublicDataError ? error : new PublicDataError('取得失敗', '公開データを取得できませんでした。'));
    });
  }, [store]);
  if (failure) {
    return <main className="state-panel" role="alert"><p className="eyebrow">{failure.kind}</p><h1>動画一覧を表示できません</h1><p>{failure.message}</p><button className="button primary" type="button" onClick={() => window.location.reload()}>再読み込み</button></main>;
  }
  if (!bundle) return <main className="state-panel" role="status"><p className="eyebrow">diopside</p><h1>公開データを読み込んでいます</h1></main>;
  return <App bundle={bundle} store={store} />;
}

const container = document.querySelector('#root');
if (!container) throw new Error('画面の起点がありません。');
createRoot(container).render(<StrictMode><HashRouter><Bootstrap /></HashRouter></StrictMode>);
