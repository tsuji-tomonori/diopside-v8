import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useBundle, useDeviceStore } from '../../contexts.ts';
import type { PublicVideoDetail } from '../../domain/content.ts';
import { formatDate, formatDuration, formatTimestamp } from '../../format.ts';
import { loadVideoDetail, PublicDataError } from '../../data/loadPublicData.ts';

export function VideoDetailPage(): React.JSX.Element {
  const { videoId = '' } = useParams();
  const bundle = useBundle();
  const store = useDeviceStore();
  const [detail, setDetail] = useState<PublicVideoDetail | null>(null);
  const [failure, setFailure] = useState<PublicDataError | null>(null);
  const [favorite, setFavorite] = useState(false);
  const summary = bundle.index.videos.find((video) => video.videoId === videoId);
  useEffect(() => {
    if (!summary) return;
    void store.recordHistory(summary);
    void store.isFavorite(videoId).then(setFavorite);
    void loadVideoDetail(videoId, bundle.latest.releaseId).then(setDetail).catch((error: unknown) => {
      setFailure(error instanceof PublicDataError ? error : new PublicDataError('取得失敗', '動画詳細を取得できませんでした。'));
    });
  }, [bundle.latest.releaseId, store, summary, videoId]);

  const tagGroups = useMemo(() => {
    if (!detail) return [];
    const selected = new Set(detail.tagIds);
    return bundle.tagIndex.categories.flatMap((category) => {
      const tags = category.subcategories.flatMap((subcategory) => subcategory.tags
        .filter((tag) => selected.has(tag.tagId))
        .map((tag) => ({ ...tag, subcategoryId: subcategory.subcategoryId, subcategoryName: subcategory.name })));
      return tags.length > 0 ? [{ ...category, tags }] : [];
    });
  }, [bundle.tagIndex.categories, detail]);

  if (!summary) return <StatePanel title="動画が見つかりません" message="公開一覧にない動画です。" />;
  if (failure) return <StatePanel title={failure.kind} message={failure.message} />;
  if (!detail) return <StatePanel title="読み込み中" message="動画詳細を確認しています。" />;

  return (
    <main className="detail-page">
      <Link className="back-link" to="/">← 検索結果へ戻る</Link>
      <article>
        <div className="detail-hero">
          <img src={detail.thumbnail.url} width={detail.thumbnail.width} height={detail.thumbnail.height} alt="" />
          <div>
            <p className="eyebrow">{formatDate(detail.publishedAt)} · {formatDuration(detail.durationSeconds)}</p>
            <h1>{detail.title}</h1>
            <div className="detail-actions">
              <a className="button primary" href={detail.youtubeUrl} target="_blank" rel="noreferrer">YouTubeで見る</a>
              <button className="button secondary" type="button" aria-pressed={favorite} onClick={() => void store.toggleFavorite(detail).then(setFavorite)}>
                {favorite ? '♥ お気に入り済み' : '♡ お気に入りに追加'}
              </button>
            </div>
          </div>
        </div>

        {detail.synopsis ? (
          <section className="detail-section synopsis-section" aria-labelledby="synopsis-heading">
            <div className="section-heading">
              <div><p className="eyebrow">動画を見る前のひとこと</p><h2 id="synopsis-heading">あらすじ</h2></div>
              <p>最終更新: {formatDate(detail.synopsis.updatedAt)}</p>
            </div>
            <p className="synopsis-copy">{detail.synopsis.body}</p>
            <blockquote className="featured-quote">
              <p>「{detail.synopsis.featuredQuote.text}」</p>
              <footer>
                <span>巴さん、この配信のひとこと</span>
                <a href={detail.synopsis.featuredQuote.youtubeUrl} target="_blank" rel="noreferrer">この場面から見る</a>
              </footer>
            </blockquote>
          </section>
        ) : null}

        <section className="detail-section" aria-labelledby="tags-heading">
          <div className="section-heading">
            <div><p className="eyebrow">diopsideが整理・確認した情報</p><h2 id="tags-heading">タグ</h2></div>
            <p>最終更新: {formatDate(detail.tagsUpdatedAt)}</p>
          </div>
          <p className="notice">YouTube公式タグではありません。公開情報を基に、人が確認した検索用の情報です。</p>
          {tagGroups.map((group) => (
            <div className="detail-tag-group" key={group.categoryId}>
              <h3>{group.name}</h3>
              <div className="detail-tags">
                {group.tags.map((tag) => {
                  if (tag.entityId) return (
                    <Link className="detail-tag-link" key={tag.tagId} to={`/entities/${tag.entityId}`}>
                      <small>{tag.subcategoryName}</small>{tag.canonicalName}<span>関連情報を見る →</span>
                    </Link>
                  );
                  if (group.categoryId === 'program' && tag.subcategoryId === 'recurringSeries') return (
                    <Link className="detail-tag-link" key={tag.tagId} to={`/series/${tag.tagId}`}>
                      <small>{tag.subcategoryName}</small>{tag.canonicalName}<span>シリーズ一覧を見る →</span>
                    </Link>
                  );
                  if (group.categoryId === 'content' && ['primary', 'secondary'].includes(tag.subcategoryId) && tag.canonicalName === 'ゲーム') return (
                    <Link className="detail-tag-link" key={tag.tagId} to="/games">
                      <small>{tag.subcategoryName}</small>{tag.canonicalName}<span>プレイしたゲームを見る →</span>
                    </Link>
                  );
                  if (group.categoryId === 'content' && tag.subcategoryId === 'gameGenre') return (
                    <Link className="detail-tag-link" key={tag.tagId} to={`/games/genres/${tag.tagId}`}>
                      <small>{tag.subcategoryName}</small>{tag.canonicalName}<span>このジャンルのゲームを見る →</span>
                    </Link>
                  );
                  if (group.categoryId === 'content' && ['primary', 'secondary'].includes(tag.subcategoryId) && tag.canonicalName === '歌') return (
                    <Link className="detail-tag-link" key={tag.tagId} to="/songs">
                      <small>{tag.subcategoryName}</small>{tag.canonicalName}<span>歌った曲を見る →</span>
                    </Link>
                  );
                  if (group.categoryId === 'works' && tag.subcategoryId === 'songTitle') return (
                    <Link className="detail-tag-link" key={tag.tagId} to={`/songs/${tag.tagId}`}>
                      <small>{tag.subcategoryName}</small>{tag.canonicalName}<span>歌唱実績を見る →</span>
                    </Link>
                  );
                  if (group.categoryId === 'works') return (
                    <Link className="detail-tag-link" key={tag.tagId} to={`/works/${tag.tagId}`}>
                      <small>{tag.subcategoryName}</small>{tag.canonicalName}<span>作品ページを見る →</span>
                    </Link>
                  );
                  if (group.categoryId === 'people' && tag.subcategoryId === 'performer' && tag.personProfile) return (
                    <Link className="detail-tag-link person-tag-link" key={tag.tagId} to={`/collaborators/${tag.tagId}`}>
                      <img src={`${import.meta.env.BASE_URL}${tag.personProfile.iconPath}`} width="38" height="38" alt="" />
                      <span><small>{tag.subcategoryName}</small>{tag.canonicalName}<b>コラボ動画を見る →</b></span>
                    </Link>
                  );
                  if (group.categoryId === 'people' && tag.subcategoryId === 'unit' && tag.groupProfile) return (
                    <Link className="detail-tag-link" key={tag.tagId} to={`/groups/${tag.tagId}`}>
                      <small>{tag.subcategoryName}</small>{tag.canonicalName}<span>コンビ・ユニットを見る →</span>
                    </Link>
                  );
                  return <span key={tag.tagId}><small>{tag.subcategoryName}</small>{tag.canonicalName}</span>;
                })}
              </div>
            </div>
          ))}
        </section>

        <section className="detail-section" aria-labelledby="timestamps-heading">
          <div className="section-heading">
            <div><p className="eyebrow">動画内を移動する目次</p><h2 id="timestamps-heading">タイムスタンプ</h2></div>
            <p>最終更新: {formatDate(detail.timestamps.updatedAt)}</p>
          </div>
          {detail.timestamps.status === '未作成' ? (
            <div className="unavailable"><strong>未作成 — {detail.timestamps.reason}</strong><p>{detail.timestamps.detail}</p></div>
          ) : (
            <>
              <p className="origin">由来: {detail.timestamps.origin}</p>
              <ol className="timestamps">
                {detail.timestamps.items.map((item) => (
                  <li key={item.timestampId}>
                    <a href={item.youtubeUrl} target="_blank" rel="noreferrer">
                      <time>{formatTimestamp(item.startSeconds)}</time>
                      <span>{item.label}</span>
                      <small>{formatTimestamp(item.startSeconds)}–{formatTimestamp(item.endSeconds)}</small>
                    </a>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section className="detail-section" aria-labelledby="word-cloud-heading">
          <div className="section-heading">
            <div><p className="eyebrow">動画を表す言葉</p><h2 id="word-cloud-heading">ワードクラウド</h2></div>
            <p>最終更新: {formatDate(detail.wordCloud.updatedAt)}</p>
          </div>
          {detail.wordCloud.status === '未作成' ? (
            <div className="unavailable"><strong>未作成 — {detail.wordCloud.reason}</strong><p>{detail.wordCloud.detail}</p></div>
          ) : (
            <div className="word-cloud" aria-label="ワードクラウド">
              {[...detail.wordCloud.words].sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term, 'ja')).map((word) => (
                <span key={word.term} style={{ fontSize: `${0.85 + word.weight / 65}rem` }}>{word.term}</span>
              ))}
            </div>
          )}
        </section>
      </article>
    </main>
  );
}

function StatePanel({ title, message }: { title: string; message: string }): React.JSX.Element {
  return <main className="state-panel" role="status"><h1>{title}</h1><p>{message}</p><Link className="button secondary" to="/">動画検索へ戻る</Link></main>;
}
