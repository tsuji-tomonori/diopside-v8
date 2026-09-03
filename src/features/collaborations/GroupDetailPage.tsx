import { Link, useParams } from 'react-router-dom';

import { VideoCard } from '../../components/VideoCard.tsx';
import { useBundle } from '../../contexts.ts';
import type { PublicVideoSummary } from '../../domain/content.ts';
import { formatDate } from '../../format.ts';

export function GroupDetailPage(): React.JSX.Element {
  const { tagId = '' } = useParams();
  const bundle = useBundle();
  const group = bundle.tagIndex.categories
    .find((category) => category.categoryId === 'people')
    ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'unit')
    ?.tags.find((tag) => tag.tagId === tagId && tag.groupProfile);

  if (!group?.groupProfile) {
    return <main className="state-panel" role="status"><h1>コンビ・ユニットが見つかりません</h1><p>公開中のコンビ・ユニットタグではありません。</p><Link className="button secondary" to="/">動画検索へ戻る</Link></main>;
  }

  const byId = new Map(bundle.index.videos.map((video) => [video.videoId, video]));
  const videos = group.videoIds
    .flatMap((videoId) => byId.get(videoId) ? [byId.get(videoId) as PublicVideoSummary] : [])
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime() || left.videoId.localeCompare(right.videoId));

  return (
    <main className="collaboration-page">
      <Link className="back-link" to="/">← 動画検索へ戻る</Link>
      <section className="page-intro group-intro" aria-labelledby="group-heading">
        <p className="eyebrow">コンビ・ユニット</p>
        <h1 id="group-heading">{group.canonicalName}</h1>
        <p className="group-description">{group.groupProfile.description}</p>
        <p className="work-source">
          出典: <a href={group.groupProfile.sourceUrl} target="_blank" rel="noreferrer">{group.groupProfile.sourceLabel}</a>
          <span>確認日: {formatDate(`${group.groupProfile.retrievedAt}T00:00:00+09:00`)}</span>
        </p>
        <h2>メンバー</h2>
        <div className="member-grid">
          {group.groupProfile.members.map((member) => (
            <a className="member-card" key={member.tagId} href={member.youtubeChannelUrl} target="_blank" rel="noreferrer">
              <img src={assetUrl(member.iconPath)} width="88" height="88" alt="" />
              <span><strong>{member.name}</strong><small>YouTubeチャンネル →</small></span>
            </a>
          ))}
        </div>
      </section>
      <section className="results collaboration-results" aria-labelledby="group-videos-heading">
        <div className="results-heading"><div><p className="eyebrow">このコンビ・ユニットの公開動画</p><h2 id="group-videos-heading">{videos.length}件の動画</h2></div></div>
        {videos.length > 0
          ? <div className="video-grid">{videos.map((video) => <VideoCard key={video.videoId} video={video} />)}</div>
          : <div className="empty-state"><h3>公開中の動画がありません</h3><p>このコンビ・ユニットタグが付いた動画の公開をお待ちください。</p></div>}
      </section>
    </main>
  );
}

function assetUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}${relativePath}`;
}
