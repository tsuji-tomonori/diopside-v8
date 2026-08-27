import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { Header } from './components/Header.tsx';
import { BundleContext, DeviceStoreContext } from './contexts.ts';
import type { DeviceStore } from './data/deviceStore.ts';
import type { PublicBundle } from './data/loadPublicData.ts';
import { DeviceLibraryPage } from './features/library/DeviceLibraryPage.tsx';
import { SearchPage } from './features/search/SearchPage.tsx';
import { SongIndexPage } from './features/songs/SongIndexPage.tsx';
import { VideoDetailPage } from './features/detail/VideoDetailPage.tsx';
import { WorkDetailPage } from './features/works/WorkDetailPage.tsx';
import { CollaboratorDetailPage } from './features/collaborations/CollaboratorDetailPage.tsx';
import { GroupDetailPage } from './features/collaborations/GroupDetailPage.tsx';
import { SeriesDetailPage } from './features/series/SeriesDetailPage.tsx';

export function App({ bundle, store }: { bundle: PublicBundle; store: DeviceStore }): React.JSX.Element {
  const [notice, setNotice] = useState('');
  useEffect(() => store.setNoticeHandler(setNotice), [store]);
  return (
    <DeviceStoreContext.Provider value={store}>
      <BundleContext.Provider value={bundle}>
        <Header />
        {notice && <div className="storage-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')}>閉じる</button></div>}
        <div id="main-content">
          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/video/:videoId" element={<VideoDetailPage />} />
            <Route path="/works/:tagId" element={<WorkDetailPage />} />
            <Route path="/songs" element={<SongIndexPage />} />
            <Route path="/songs/:tagId" element={<SongIndexPage />} />
            <Route path="/collaborators/:tagId" element={<CollaboratorDetailPage />} />
            <Route path="/groups/:tagId" element={<GroupDetailPage />} />
            <Route path="/series/:tagId" element={<SeriesDetailPage />} />
            <Route path="/library" element={<DeviceLibraryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <footer><p>diopside — 公開情報を、人が確認した静的アーカイブ検索。</p><p>ログイン・追跡・端末間同期は行いません。</p></footer>
      </BundleContext.Provider>
    </DeviceStoreContext.Provider>
  );
}
