import { Link, useParams } from 'react-router-dom';

import { VideoCard } from '../../components/VideoCard.tsx';
import { useBundle } from '../../contexts.ts';
import type { PublicVideoSummary } from '../../domain/content.ts';

export function SeriesDetailPage(): React.JSX.Element {
  const { tagId = '' } = useParams();
  const bundle = useBundle();
  const series = bundle.tagIndex.categories
    .find((category) => category.categoryId === 'program')
    ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'recurringSeries')
    ?.tags.find((tag) => tag.tagId === tagId);

  if (!series) {
    return <main className="state-panel" role="status"><h1>企画・シリーズが見つかりません</h1><p>公開中の定期・連続企画タグではありません。</p><Link className="button secondary" to="/">動画検索へ戻る</Link></main>;
  }

  const summaries = new Map(bundle.index.videos.map((video) => [video.videoId, video]));
  const videos = series.videoIds
    .flatMap((videoId) => summaries.get(videoId) ? [summaries.get(videoId) as PublicVideoSummary] : [])
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime() || left.videoId.localeCompare(right.videoId));

  return (
    <main className="work-page series-page">
      <Link className="back-link" to="/">← 動画検索へ戻る</Link>
      <section className="page-intro work-intro" aria-labelledby="series-heading">
        <p className="eyebrow">定期・連続企画名</p>
        <h1 id="series-heading">{series.canonicalName}</h1>
        <p>この企画・シリーズに含まれる公開動画をまとめています。</p>
      </section>

      <section className="results work-results series-results" aria-labelledby="series-videos-heading">
        <div className="results-heading">
          <div><p className="eyebrow">この企画・シリーズの動画</p><h2 id="series-videos-heading">{videos.length}件の動画</h2></div>
        </div>
        {videos.length > 0 ? (
          <div className="video-grid">{videos.map((video) => <VideoCard key={video.videoId} video={video} />)}</div>
        ) : (
          <div className="empty-state"><h3>公開中の動画がありません</h3><p>この定期・連続企画タグが付いた動画の公開をお待ちください。</p></div>
        )}
      </section>
    </main>
  );
}
