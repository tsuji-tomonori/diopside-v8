import {
  publicEntityIndexSchema,
  type CanonicalVideo,
  type ChannelPersonMappings,
  type CollaborationProfiles,
  type GameCatalog,
  type PublicEntityIndex,
  type SongPerformanceCatalog,
  type TagTaxonomy,
  type VideoEntityRole,
} from './content.ts';

type Entity = PublicEntityIndex['entities'][number];
type EntityRelation = Entity['relations'][number];
type EntitySource = Entity['sources'][number];
type EntityType = Entity['entityType'];

interface MutableEntity {
  entityId: string;
  entityType: EntityType;
  canonicalName: string;
  normalizedReading: string;
  legacyTagIds: Set<string>;
  classificationTagIds: Set<string>;
  description?: string;
  imagePath?: string;
  externalUrl?: string;
  sources: Map<string, EntitySource>;
  relations: Map<string, EntityRelation>;
  videosByRole: Map<VideoEntityRole, Set<string>>;
}

interface TagSemantics {
  canonicalName: string;
  entityType: EntityType;
  role: VideoEntityRole;
}

export interface EntityProjection {
  index: PublicEntityIndex;
  entityIdByLegacyTagId: Map<string, string>;
  entityRefsByVideoId: Map<string, Array<{ entityId: string; roles: VideoEntityRole[] }>>;
}

export interface BuildEntityProjectionInput {
  releaseId: string;
  updatedAt: string;
  taxonomy: TagTaxonomy;
  gameCatalog: GameCatalog;
  songPerformances: SongPerformanceCatalog;
  collaborationProfiles: CollaborationProfiles;
  channelPersonMappings: ChannelPersonMappings;
  videos: CanonicalVideo[];
  normalizeReading: (value: string) => string;
}

export function buildEntityProjection(input: BuildEntityProjectionInput): EntityProjection {
  const entities = new Map<string, MutableEntity>();
  const entityIdByLegacyTagId = new Map<string, string>();
  const tagSemantics = collectTagSemantics(input.taxonomy);

  const addEntity = (value: {
    entityId: string;
    entityType: EntityType;
    canonicalName: string;
    legacyTagIds?: string[];
    classificationTagIds?: string[];
    description?: string;
    imagePath?: string;
    externalUrl?: string;
    sources?: EntitySource[];
  }): MutableEntity => {
    const prior = entities.get(value.entityId);
    if (prior && (prior.entityType !== value.entityType || normalizeKey(prior.canonicalName) !== normalizeKey(value.canonicalName))) {
      throw new Error(`エンティティIDが別の意味と衝突しています: ${value.entityId}`);
    }
    const entity = prior ?? {
      entityId: value.entityId,
      entityType: value.entityType,
      canonicalName: value.canonicalName,
      normalizedReading: input.normalizeReading(value.canonicalName),
      legacyTagIds: new Set<string>(),
      classificationTagIds: new Set<string>(),
      sources: new Map<string, EntitySource>(),
      relations: new Map<string, EntityRelation>(),
      videosByRole: new Map<VideoEntityRole, Set<string>>(),
    };
    for (const tagId of value.legacyTagIds ?? []) {
      entity.legacyTagIds.add(tagId);
      const mapped = entityIdByLegacyTagId.get(tagId);
      if (mapped && mapped !== entity.entityId) throw new Error(`旧タグIDが複数エンティティへ解決されます: ${tagId}`);
      entityIdByLegacyTagId.set(tagId, entity.entityId);
    }
    for (const tagId of value.classificationTagIds ?? []) entity.classificationTagIds.add(tagId);
    if (value.description) entity.description = value.description;
    if (value.imagePath) entity.imagePath = value.imagePath;
    if (value.externalUrl) entity.externalUrl = value.externalUrl;
    for (const source of value.sources ?? []) entity.sources.set(`${source.url}\0${source.label}`, source);
    entities.set(entity.entityId, entity);
    return entity;
  };

  const addRelation = (fromEntityId: string, relation: EntityRelation): void => {
    const entity = requiredEntity(entities, fromEntityId);
    entity.relations.set(`${relation.relationType}\0${relation.entityId}`, relation);
  };

  for (const game of input.gameCatalog.games) {
    const legacyTagIds = [game.gameTitleTagId, ...(game.equivalentGameTitleTagIds ?? [])];
    addEntity({
      entityId: entityIdFromTag('game', game.gameTitleTagId),
      entityType: 'game',
      canonicalName: game.title,
      legacyTagIds,
      classificationTagIds: game.gameGenreTagIds,
      sources: game.sources.map((source) => ({ url: source.url, label: source.label, checkedAt: source.checkedAt })),
    });
  }

  const profilesByTagId = new Map(input.collaborationProfiles.people.map((person) => [person.tagId, person]));
  const personByName = new Map<string, string>();
  for (const [tagId, semantics] of tagSemantics) {
    if (semantics.entityType !== 'person' || semantics.role !== 'features') continue;
    const profile = profilesByTagId.get(tagId);
    const entityId = entityIdFromTag('person', tagId);
    addEntity({
      entityId,
      entityType: 'person',
      canonicalName: semantics.canonicalName,
      legacyTagIds: [tagId],
      ...(profile ? {
        description: profile.description,
        imagePath: `data/releases/${input.releaseId}/people/icons/${profile.iconFile}`,
        externalUrl: profile.youtubeChannelUrl,
        sources: [{ url: profile.sourceUrl, label: profile.sourceLabel, checkedAt: profile.retrievedAt }],
      } : {}),
    });
    personByName.set(normalizeKey(semantics.canonicalName), entityId);
  }
  for (const [tagId, semantics] of tagSemantics) {
    if (semantics.entityType !== 'person' || semantics.role !== 'mentions') continue;
    const entityId = personByName.get(normalizeKey(semantics.canonicalName)) ?? entityIdFromTag('person', tagId);
    addEntity({ entityId, entityType: 'person', canonicalName: semantics.canonicalName, legacyTagIds: [tagId] });
    personByName.set(normalizeKey(semantics.canonicalName), entityId);
  }

  for (const group of input.collaborationProfiles.groups) {
    const entity = addEntity({
      entityId: entityIdFromTag('group', group.tagId),
      entityType: 'group',
      canonicalName: group.name,
      legacyTagIds: [group.tagId],
      description: group.description,
      sources: [{ url: group.sourceUrl, label: group.sourceLabel, checkedAt: group.retrievedAt }],
    });
    for (const memberTagId of group.memberTagIds) {
      const memberEntityId = entityIdByLegacyTagId.get(memberTagId);
      if (!memberEntityId) throw new Error(`グループの人物エンティティを解決できません: ${group.name}:${memberTagId}`);
      addRelation(entity.entityId, { relationType: 'hasMember', entityId: memberEntityId });
      addRelation(memberEntityId, { relationType: 'memberOf', entityId: entity.entityId });
    }
  }

  const personIdByChannelTagId = new Map(input.channelPersonMappings.mappings.map((mapping) => [
    mapping.channelTagId,
    entityIdByLegacyTagId.get(mapping.personTagId),
  ]));
  for (const [tagId, semantics] of tagSemantics) {
    if (semantics.entityType !== 'channel') continue;
    const representedPersonId = personIdByChannelTagId.get(tagId);
    const representedPerson = representedPersonId ? entities.get(representedPersonId) : undefined;
    const channel = addEntity({
      entityId: entityIdFromTag('channel', tagId),
      entityType: 'channel',
      canonicalName: semantics.canonicalName,
      legacyTagIds: [tagId],
      ...(representedPerson?.externalUrl ? { externalUrl: representedPerson.externalUrl } : {}),
      ...(representedPerson ? { sources: [...representedPerson.sources.values()] } : {}),
    });
    if (representedPersonId) addRelation(channel.entityId, { relationType: 'represents', entityId: representedPersonId });
  }

  const songTags = entityTags(input.taxonomy, 'song');
  for (const tag of songTags) {
    const entityId = entityIdFromTag('song', tag.tagId);
    addEntity({ entityId, entityType: 'song', canonicalName: tag.canonicalName, legacyTagIds: [tag.tagId] });
  }
  for (const song of input.songPerformances.songs) {
    const songEntityId = entityIdByLegacyTagId.get(song.tagId) ?? entityIdFromTag('song', song.tagId);
    const songEntity = addEntity({
      entityId: songEntityId,
      entityType: 'song',
      canonicalName: song.title,
      legacyTagIds: [song.tagId],
      sources: [{ url: song.original.url, label: song.original.sourceLabel, checkedAt: song.original.retrievedAt }],
    });
    const artistEntity = addEntity({
      entityId: entityIdFromName('artist', song.original.artist),
      entityType: 'artist',
      canonicalName: song.original.artist,
      sources: [{ url: song.original.url, label: song.original.sourceLabel, checkedAt: song.original.retrievedAt }],
    });
    addRelation(songEntity.entityId, { relationType: 'createdBy', entityId: artistEntity.entityId });
  }

  const mergeableWorkByName = new Map<string, string[]>();
  const registerMergeableWork = (name: string, entityId: string): void => {
    const key = normalizeKey(name);
    const values = mergeableWorkByName.get(key) ?? [];
    if (!values.includes(entityId)) values.push(entityId);
    mergeableWorkByName.set(key, values);
  };
  for (const entity of entities.values()) {
    if (['game', 'song', 'series', 'work'].includes(entity.entityType)) registerMergeableWork(entity.canonicalName, entity.entityId);
  }
  for (const [tagId, semantics] of tagSemantics) {
    if (entityIdByLegacyTagId.has(tagId)) continue;
    const entityType = semantics.entityType;
    if (entityType === 'work' && semantics.role === 'mentions') {
      const candidates = mergeableWorkByName.get(normalizeKey(semantics.canonicalName)) ?? [];
      if (candidates.length === 1) {
        addEntity({
          entityId: candidates[0]!,
          entityType: requiredEntity(entities, candidates[0]!).entityType,
          canonicalName: semantics.canonicalName,
          legacyTagIds: [tagId],
        });
        continue;
      }
    }
    const entityId = entityIdFromTag(entityType, tagId);
    addEntity({ entityId, entityType, canonicalName: semantics.canonicalName, legacyTagIds: [tagId] });
    if (['game', 'song', 'series', 'work'].includes(entityType)) registerMergeableWork(semantics.canonicalName, entityId);
  }

  for (const [tagId, semantics] of tagSemantics) {
    if (!entityIdByLegacyTagId.has(tagId)) {
      throw new Error(`有効なエンティティ参照タグを解決できません: ${semantics.canonicalName}:${tagId}`);
    }
  }

  const rolesByVideo = new Map<string, Map<string, Set<VideoEntityRole>>>();
  const addVideoRelation = (videoId: string, entityId: string, role: VideoEntityRole): void => {
    const byEntity = rolesByVideo.get(videoId) ?? new Map<string, Set<VideoEntityRole>>();
    const roles = byEntity.get(entityId) ?? new Set<VideoEntityRole>();
    roles.add(role);
    byEntity.set(entityId, roles);
    rolesByVideo.set(videoId, byEntity);
    const entity = requiredEntity(entities, entityId);
    const videoIds = entity.videosByRole.get(role) ?? new Set<string>();
    videoIds.add(videoId);
    entity.videosByRole.set(role, videoIds);
  };

  for (const video of input.videos) {
    for (const assignment of video.tagAssignments) {
      const semantics = tagSemantics.get(assignment.tagId);
      if (!semantics) continue;
      const entityId = entityIdByLegacyTagId.get(assignment.tagId);
      if (!entityId) throw new Error(`${video.videoId}: エンティティ参照タグの解決先がありません: ${assignment.tagId}`);
      addVideoRelation(video.videoId, entityId, semantics.role);
    }
  }
  for (const song of input.songPerformances.songs) {
    const entityId = entityIdByLegacyTagId.get(song.tagId);
    if (!entityId) throw new Error(`楽曲エンティティを解決できません: ${song.tagId}`);
    for (const appearance of song.appearances) addVideoRelation(appearance.videoId, entityId, 'performs');
  }

  for (const byEntity of rolesByVideo.values()) {
    const eventEntityIds = [...byEntity.keys()].filter((entityId) => entities.get(entityId)?.entityType === 'event');
    const gameEntityIds = [...byEntity.keys()].filter((entityId) => entities.get(entityId)?.entityType === 'game');
    for (const eventEntityId of eventEntityIds) {
      for (const gameEntityId of gameEntityIds) addRelation(eventEntityId, { relationType: 'usesGame', entityId: gameEntityId });
    }
  }

  const includedEntityIds = publicEntityClosure(entities);
  const publicEntities = [...includedEntityIds]
    .map((entityId) => toPublicEntity(requiredEntity(entities, entityId)))
    .sort((left, right) => left.entityType.localeCompare(right.entityType) || left.normalizedReading.localeCompare(right.normalizedReading, 'ja') || left.entityId.localeCompare(right.entityId));
  const entityRefsByVideoId = new Map([...rolesByVideo].map(([videoId, byEntity]) => [
    videoId,
    [...byEntity]
      .filter(([entityId]) => includedEntityIds.has(entityId))
      .map(([entityId, roles]) => ({ entityId, roles: [...roles].sort() }))
      .sort((left, right) => left.entityId.localeCompare(right.entityId)),
  ]));

  const index = publicEntityIndexSchema.parse({
    schemaVersion: '1.0.0',
    releaseId: input.releaseId,
    updatedAt: input.updatedAt,
    entities: publicEntities,
    coverage: buildCoverage(publicEntities, input.videos, input.taxonomy, rolesByVideo),
  });
  return { index, entityIdByLegacyTagId, entityRefsByVideoId };
}

function collectTagSemantics(taxonomy: TagTaxonomy): Map<string, TagSemantics> {
  const result = new Map<string, TagSemantics>();
  for (const category of taxonomy.categories) {
    for (const subcategory of category.subcategories) {
      if (subcategory.valueKind !== 'entity-reference') continue;
      if (!subcategory.entityType || !subcategory.videoRelation) {
        throw new Error(`エンティティ参照小分類に型と動画関係がありません: ${category.categoryId}.${subcategory.subcategoryId}`);
      }
      for (const tag of subcategory.tags.filter((item) => item.active)) {
        result.set(tag.tagId, {
          canonicalName: tag.canonicalName,
          entityType: subcategory.entityType,
          role: subcategory.videoRelation,
        });
      }
    }
  }
  return result;
}

function entityTags(taxonomy: TagTaxonomy, entityType: EntityType): Array<{ tagId: string; canonicalName: string }> {
  return taxonomy.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => (
    subcategory.valueKind === 'entity-reference' && subcategory.entityType === entityType
      ? subcategory.tags.filter((tag) => tag.active).map((tag) => ({ tagId: tag.tagId, canonicalName: tag.canonicalName }))
      : []
  )));
}

function toPublicEntity(entity: MutableEntity): Entity {
  return {
    entityId: entity.entityId,
    entityType: entity.entityType,
    canonicalName: entity.canonicalName,
    normalizedReading: entity.normalizedReading,
    legacyTagIds: [...entity.legacyTagIds].sort(),
    classificationTagIds: [...entity.classificationTagIds].sort(),
    ...(entity.description ? { description: entity.description } : {}),
    ...(entity.imagePath ? { imagePath: entity.imagePath } : {}),
    ...(entity.externalUrl ? { externalUrl: entity.externalUrl } : {}),
    sources: [...entity.sources.values()].sort((left, right) => left.url.localeCompare(right.url) || left.label.localeCompare(right.label, 'ja')),
    relations: [...entity.relations.values()].sort((left, right) => left.relationType.localeCompare(right.relationType) || left.entityId.localeCompare(right.entityId)),
    videoRelations: [...entity.videosByRole]
      .filter(([, videoIds]) => videoIds.size > 0)
      .map(([role, videoIds]) => ({ role, videoIds: [...videoIds].sort() }))
      .sort((left, right) => left.role.localeCompare(right.role)),
  };
}

function publicEntityClosure(entities: Map<string, MutableEntity>): Set<string> {
  const included = new Set([...entities.values()].filter((entity) => entity.videosByRole.size > 0).map((entity) => entity.entityId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const entity of entities.values()) {
      if (included.has(entity.entityId)) {
        for (const relation of entity.relations.values()) {
          if (!included.has(relation.entityId)) {
            included.add(relation.entityId);
            changed = true;
          }
        }
      } else if ([...entity.relations.values()].some((relation) => included.has(relation.entityId))) {
        included.add(entity.entityId);
        changed = true;
      }
    }
  }
  return included;
}

function buildCoverage(
  entities: Entity[],
  videos: CanonicalVideo[],
  taxonomy: TagTaxonomy,
  rolesByVideo: Map<string, Map<string, Set<VideoEntityRole>>>,
): PublicEntityIndex['coverage'] {
  const relationCount = (entityType: EntityType, roles: VideoEntityRole[]): number => entities
    .filter((entity) => entity.entityType === entityType)
    .flatMap((entity) => entity.videoRelations)
    .filter((relation) => roles.includes(relation.role))
    .reduce((total, relation) => total + relation.videoIds.length, 0);
  const entityCount = (entityType: EntityType, roles: VideoEntityRole[]): number => entities.filter((entity) => (
    entity.entityType === entityType && entity.videoRelations.some((relation) => roles.includes(relation.role))
  )).length;
  const gameCount = entityCount('game', ['plays']);
  const gameClassificationTagIds = new Set(taxonomy.categories
    .find((category) => category.categoryId === 'content')
    ?.subcategories.filter((subcategory) => ['primary', 'secondary'].includes(subcategory.subcategoryId))
    .flatMap((subcategory) => subcategory.tags.filter((tag) => tag.active && tag.canonicalName === 'ゲーム').map((tag) => tag.tagId)) ?? []);
  const gameCandidateCount = videos.filter((video) => (
    video.tagAssignments.some((assignment) => gameClassificationTagIds.has(assignment.tagId))
    && ![...(rolesByVideo.get(video.videoId) ?? [])].some(([entityId, roles]) => (
      entities.some((entity) => entity.entityId === entityId && entity.entityType === 'game') && roles.has('plays')
    ))
  )).length;
  const gameRelationCount = relationCount('game', ['plays']);
  return [
    {
      scope: 'songs', expectedCount: null,
      actualEntityCount: entityCount('song', ['performs', 'featuresMusic']),
      actualRelationCount: relationCount('song', ['performs', 'featuresMusic']),
      candidateCount: null, status: 'partial',
      cause: '通常配信を含む全動画・全タイムスタンプの楽曲再抽出が未完了のため、期待件数と未抽出候補数は未確定です。',
    },
    {
      scope: 'performers', expectedCount: null,
      actualEntityCount: entityCount('person', ['features']),
      actualRelationCount: relationCount('person', ['features']),
      candidateCount: null, status: 'partial',
      cause: '出演者の全動画横断再走査が未完了のため、期待件数と未抽出候補数は未確定です。',
    },
    {
      scope: 'mentionedPeople', expectedCount: null,
      actualEntityCount: entityCount('person', ['mentions']),
      actualRelationCount: relationCount('person', ['mentions']),
      candidateCount: null, status: 'partial',
      cause: '言及人物の全文横断抽出が未完了のため、期待件数と未抽出候補数は未確定です。',
    },
    {
      scope: 'gameTitles', expectedCount: gameRelationCount + gameCandidateCount,
      actualEntityCount: gameCount,
      actualRelationCount: gameRelationCount,
      candidateCount: gameCandidateCount, status: gameCandidateCount === 0 ? 'complete' : 'partial',
      cause: gameCandidateCount === 0
        ? 'ゲーム分類の全動画を正式作品名のゲーム正本へ解決し、一般語とイベントを除外しています。'
        : `ゲーム分類のうち${gameCandidateCount}動画は公開根拠だけで正式作品名を特定できず、無理に文字列タグを付けず再監査候補として保持しています。`,
    },
    {
      scope: 'events', expectedCount: null,
      actualEntityCount: entityCount('event', ['participatesIn']),
      actualRelationCount: relationCount('event', ['participatesIn']),
      candidateCount: null, status: 'partial',
      cause: '過去動画の企画・大会・イベント再抽出が未完了のため、期待件数と未抽出候補数は未確定です。',
    },
  ];
}

function requiredEntity(entities: Map<string, MutableEntity>, entityId: string): MutableEntity {
  const entity = entities.get(entityId);
  if (!entity) throw new Error(`エンティティを解決できません: ${entityId}`);
  return entity;
}

function entityIdFromTag(entityType: EntityType, tagId: string): string {
  const suffix = tagId.match(/([a-f0-9]{12})$/u)?.[1] ?? stableDigest(tagId);
  return `entity-${entityType}-${suffix}`;
}

function entityIdFromName(entityType: EntityType, canonicalName: string): string {
  return `entity-${entityType}-${stableDigest(`${entityType}\0${normalizeKey(canonicalName)}`)}`;
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/^#/u, '').replace(/\s+/gu, ' ').toLocaleLowerCase('ja-JP');
}

function stableDigest(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0').slice(-12);
}
