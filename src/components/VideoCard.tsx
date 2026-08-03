import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useDeviceStore } from '../contexts.ts';
import type { PublicVideoSummary } from '../domain/content.ts';
import { formatDate, formatDuration } from '../format.ts';

export function VideoCard({ video }: { video: PublicVideoSummary }): React.JSX.Element {
  const store = useDeviceStore();
  const [favorite, setFavorite] = useState(false);
  useEffect(() => {
    void store.isFavorite(video.videoId).then(setFavorite);
  }, [store, video.videoId]);

  return (
    <article className="video-card" data-video-id={video.videoId}>
      <Link className="thumbnail-link" to={`/video/${video.videoId}`} aria-label={`${video.title}の詳細を見る`}>
        <img src={video.thumbnail.url} width={video.thumbnail.width} height={video.thumbnail.height} alt="" loading="lazy" />
        <span className="duration">{formatDuration(video.durationSeconds)}</span>
      </Link>
      <div className="video-card-body">
        <p className="eyebrow">{formatDate(video.publishedAt)}</p>
        <h2><Link to={`/video/${video.videoId}`}>{video.title}</Link></h2>
        <div className="card-actions">
          <Link className="button secondary" to={`/video/${video.videoId}`}>詳細を見る</Link>
          <button
            className="icon-button"
            type="button"
            aria-pressed={favorite}
            aria-label={favorite ? 'お気に入りから解除' : 'お気に入りに追加'}
            onClick={() => void store.toggleFavorite(video).then(setFavorite)}
          >
            <span aria-hidden="true">{favorite ? '♥' : '♡'}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
