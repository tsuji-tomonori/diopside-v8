import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { VideoCard } from '../../components/VideoCard.tsx';
import { useBundle } from '../../contexts.ts';
import type { EntityType, PublicEntityIndex, PublicVideoSummary, VideoEntityRole } from '../../domain/content.ts';

type Entity = PublicEntityIndex['entities'][number];

const typeLabels: Record<EntityType, string> = {
  person: '人物',
  group: 'グループ',
  channel: '配信元チャンネル',
  game: 'ゲーム作品',
  event: 'イベント・企画',
  series: 'シリーズ',
  song: '楽曲',
  work: '作品',
  artist: '原アーティスト',
};

const roleLabels: Record<VideoEntityRole, string> = {
  publishedBy: '配信元',
  features: '出演・参加',
  mentions: '言及',
  plays: 'プレイ',
  watches: '同時視聴',
  performs: '歌唱',
  featuresMusic: '使用・関連楽曲',
  participatesIn: 'イベント参加',
  partOfSeries: 'シリーズに所属',
};

const relationLabels: Record<Entity['relations'][number]['relationType'], string> = {
  represents: '表す人物',
  memberOf: '所属グループ',
  hasMember: 'メンバー',
  createdBy: '原アーティスト',
  usesGame: '対象ゲーム',
};

export function EntityIndexPage(): React.JSX.Element {
  const { entityId } = useParams();
  const bundle = useBundle();
  if (entityId) return <EntityDetail entityId={entityId} />;

  const [query, setQuery] = useState('');
  const [entityType, setEntityType] = useState<EntityType | 'all'>('all');
  const entities = useMemo(() => {
    const normalized = query.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
    return bundle.entityIndex.entities.filter((entity) => (
      (entityType === 'all' || entity.entityType === entityType)
      && (!normalized || `${entity.canonicalName} ${entity.normalizedReading}`.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(normalized))
    ));
  }, [bundle.entityIndex.entities, entityType, query]);
  const types = [...new Set(bundle.entityIndex.entities.map((entity) => entity.entityType))]
    .sort((left, right) => typeLabels[left].localeCompare(typeLabels[right], 'ja'));

  return (
    <main className="entity-page">
      <section className="page-intro entity-intro">
        <p className="eyebrow">意味でつながるアーカイブ</p>
        <h1>人物・作品・企画から探す</h1>
        <p>同じ人物や作品を一つのIDにまとめ、出演・言及・プレイ・歌唱などの関係を区別して表示します。</p>
      </section>
      <section className="entity-toolbar" aria-label="エンティティを絞り込む">
        <label>名前で検索<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="人物名・作品名・イベント名" /></label>
        <label>種類<select value={entityType} onChange={(event) => setEntityType(event.target.value as EntityType | 'all')}>
          <option value="all">すべて</option>
          {types.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}
        </select></label>
      </section>
      <section className="results" aria-labelledby="entity-results-heading">
        <div className="results-heading"><div><p className="eyebrow">検索結果</p><h2 id="entity-results-heading">{entities.length}件</h2></div></div>
        <div className="entity-grid">
          {entities.map((entity) => (
            <Link className="entity-card" key={entity.entityId} to={`/entities/${entity.entityId}`}>
              <span>{typeLabels[entity.entityType]}</span>
              <h3>{entity.canonicalName}</h3>
              <p>{videoCount(entity)}件の関連動画 · {entity.relations.length}件の関連エンティティ</p>
            </Link>
          ))}
        </div>
        {entities.length === 0 ? <div className="empty-state"><h3>一致する項目がありません</h3><p>名前を短くするか、種類を変更してください。</p></div> : null}
      </section>
    </main>
  );
}

function EntityDetail({ entityId }: { entityId: string }): React.JSX.Element {
  const bundle = useBundle();
  const entity = bundle.entityIndex.entities.find((item) => item.entityId === entityId);
  if (!entity) {
    return <main className="state-panel" role="status"><h1>項目が見つかりません</h1><p>公開中の人物・作品・企画ではありません。</p><Link className="button secondary" to="/entities">一覧へ戻る</Link></main>;
  }
  const entitiesById = new Map(bundle.entityIndex.entities.map((item) => [item.entityId, item]));
  const videosById = new Map(bundle.index.videos.map((video) => [video.videoId, video]));
  const videos = [...new Set(entity.videoRelations.flatMap((relation) => relation.videoIds))]
    .flatMap((videoId) => videosById.get(videoId) ? [videosById.get(videoId) as PublicVideoSummary] : [])
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.videoId.localeCompare(right.videoId));
  const classificationTags = entity.classificationTagIds.flatMap((tagId) => {
    const tag = bundle.tagIndex.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags)).find((item) => item.tagId === tagId);
    return tag ? [tag] : [];
  });

  return (
    <main className="entity-page entity-detail-page">
      <Link className="back-link" to="/entities">← 人物・作品・企画へ戻る</Link>
      <section className="page-intro entity-detail-intro" aria-labelledby="entity-heading">
        {entity.imagePath ? <img className="person-avatar" src={`${import.meta.env.BASE_URL}${entity.imagePath}`} width="160" height="160" alt="" /> : null}
        <div>
          <p className="eyebrow">{typeLabels[entity.entityType]}</p>
          <h1 id="entity-heading">{entity.canonicalName}</h1>
          {entity.description ? <p>{entity.description}</p> : null}
          {entity.externalUrl ? <a className="button secondary" href={entity.externalUrl} target="_blank" rel="noreferrer">公式ページを見る</a> : null}
        </div>
      </section>

      {entity.videoRelations.length > 0 ? (
        <section className="entity-relations" aria-labelledby="video-relations-heading">
          <h2 id="video-relations-heading">動画との関係</h2>
          <div className="entity-relation-chips">
            {entity.videoRelations.map((relation) => <span key={relation.role}>{roleLabels[relation.role]} <strong>{relation.videoIds.length}件</strong></span>)}
          </div>
        </section>
      ) : null}

      {entity.relations.length > 0 ? (
        <section className="entity-relations" aria-labelledby="entity-relations-heading">
          <h2 id="entity-relations-heading">関連する人物・作品・企画</h2>
          <div className="entity-related-grid">
            {entity.relations.flatMap((relation) => {
              const related = entitiesById.get(relation.entityId);
              return related ? [<Link key={`${relation.relationType}-${relation.entityId}`} to={`/entities/${relation.entityId}`}><small>{relationLabels[relation.relationType]}</small><strong>{related.canonicalName}</strong><span>{typeLabels[related.entityType]}</span></Link>] : [];
            })}
          </div>
        </section>
      ) : null}

      {classificationTags.length > 0 ? (
        <section className="entity-relations" aria-labelledby="entity-classification-heading">
          <h2 id="entity-classification-heading">分類</h2>
          <div className="entity-relation-chips">{classificationTags.map((tag) => <Link key={tag.tagId} to={`/?tag=${tag.tagId}`}>{tag.canonicalName}</Link>)}</div>
        </section>
      ) : null}

      <section className="results entity-videos" aria-labelledby="entity-videos-heading">
        <div className="results-heading"><div><p className="eyebrow">関連動画</p><h2 id="entity-videos-heading">{videos.length}件の動画</h2></div></div>
        {videos.length > 0 ? <div className="video-grid">{videos.map((video) => <VideoCard key={video.videoId} video={video} />)}</div> : <div className="empty-state"><h3>直接関連する動画はありません</h3><p>関連エンティティからこの項目へ接続しています。</p></div>}
      </section>
    </main>
  );
}

function videoCount(entity: Entity): number {
  return new Set(entity.videoRelations.flatMap((relation) => relation.videoIds)).size;
}
