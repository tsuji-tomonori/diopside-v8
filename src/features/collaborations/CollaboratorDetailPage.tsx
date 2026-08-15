import { Link, useParams } from 'react-router-dom';

import { VideoCard } from '../../components/VideoCard.tsx';
import { useBundle } from '../../contexts.ts';
import type { PublicVideoSummary } from '../../domain/content.ts';

export function CollaboratorDetailPage(): React.JSX.Element {
  const { tagId = '' } = useParams();
  const bundle = useBundle();
  const collaborator = bundle.tagIndex.categories
    .find((category) => category.categoryId === 'people')
    ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'performer')
    ?.tags.find((tag) => tag.tagId === tagId && tag.personProfile);

  if (!collaborator?.personProfile) {
    return <main className="state-panel" role="status"><h1>コラボ相手が見つかりません</h1><p>公開中の人物タグではありません。</p><Link className="button secondary" to="/">動画検索へ戻る</Link></main>;
  }

  const videos = relatedVideos(bundle.index.videos, collaborator.videoIds);
  return (
    <main className="collaboration-page">
      <Link className="back-link" to="/">← 動画検索へ戻る</Link>
      <section className="page-intro person-intro" aria-labelledby="collaborator-heading">
        <img className="person-avatar" src={assetUrl(collaborator.personProfile.iconPath)} width="160" height="160" alt="" />
        <div>
          <p className="eyebrow">コラボ相手</p>
          <h1 id="collaborator-heading">{collaborator.canonicalName}</h1>
          <a className="button youtube-link" href={collaborator.personProfile.youtubeChannelUrl} target="_blank" rel="noreferrer">
            YouTubeチャンネルを見る
          </a>
        </div>
      </section>
      <RelatedVideos title={`${collaborator.canonicalName}との動画`} videos={videos} />
    </main>
  );
}

function RelatedVideos({ title, videos }: { title: string; videos: PublicVideoSummary[] }): React.JSX.Element {
  return (
    <section className="results collaboration-results" aria-labelledby="collaboration-videos-heading">
      <div className="results-heading"><div><p className="eyebrow">一緒に出演した公開動画</p><h2 id="collaboration-videos-heading">{title} · {videos.length}件</h2></div></div>
      {videos.length > 0
        ? <div className="video-grid">{videos.map((video) => <VideoCard key={video.videoId} video={video} />)}</div>
        : <div className="empty-state"><h3>公開中の動画がありません</h3><p>この人物タグが付いた動画の公開をお待ちください。</p></div>}
    </section>
  );
}

function relatedVideos(summaries: PublicVideoSummary[], videoIds: string[]): PublicVideoSummary[] {
  const byId = new Map(summaries.map((video) => [video.videoId, video]));
  return videoIds
    .flatMap((videoId) => byId.get(videoId) ? [byId.get(videoId) as PublicVideoSummary] : [])
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime() || left.videoId.localeCompare(right.videoId));
}

function assetUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}${relativePath}`;
}
