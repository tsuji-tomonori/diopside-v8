import {
  buildTaxonomyLookup,
  type CanonicalVideo,
  type ChannelPersonMappings,
  type GameCatalog,
  type TagTaxonomy,
} from './content.ts';

export const minimumParallelPerspectiveOverlapSeconds = 300;

export interface ParallelGamePerspective {
  videoId: string;
  preferredVideoId: string;
  gameTitleTagId: string;
  overlapSeconds: number;
}

interface VideoScope {
  video: CanonicalVideo;
  gameTitleTagIds: string[];
  isStream: boolean;
  isCollaboration: boolean;
  isSubjectChannel: boolean;
  isExternalPersonChannel: boolean;
}

/**
 * 同一ゲームセッションの参加者別配信候補を検出します。
 * 公開時間が5分以上重なる同一ゲームの配信を機械的な候補とし、
 * 最終的な同一セッション判定は公式タイトルと参加者表記で確認します。
 */
export function findParallelGamePerspectives(
  videos: CanonicalVideo[],
  taxonomy: TagTaxonomy,
  channelPersonMappings: ChannelPersonMappings,
  subjectPersonTagId: string,
  gameCatalog: GameCatalog,
): ParallelGamePerspective[] {
  const lookup = buildTaxonomyLookup(taxonomy);
  const personByChannel = new Map(channelPersonMappings.mappings.map((mapping) => (
    [mapping.channelTagId, mapping.personTagId] as const
  )));
  const subjectChannelTagIds = new Set(channelPersonMappings.mappings
    .filter((mapping) => mapping.personTagId === subjectPersonTagId)
    .map((mapping) => mapping.channelTagId));
  const canonicalGameTitleByTagId = new Map(gameCatalog.games.flatMap((game) => (
    [game.gameTitleTagId, ...(game.equivalentGameTitleTagIds ?? [])]
      .map((tagId) => [tagId, game.gameTitleTagId] as const)
  )));
  const scoped = videos.map((video): VideoScope => {
    const assignedTagIds = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
    const channelTagIds = [...assignedTagIds].filter((tagId) => {
      const tag = lookup.get(tagId);
      return tag?.categoryId === 'people' && tag.subcategoryId === 'channel';
    });
    return {
      video,
      gameTitleTagIds: [...new Set([...assignedTagIds].flatMap((tagId) => {
        const canonicalTagId = canonicalGameTitleByTagId.get(tagId);
        return canonicalTagId ? [canonicalTagId] : [];
      }))],
      isStream: [...assignedTagIds].some((tagId) => {
        const tag = lookup.get(tagId);
        return tag?.categoryId === 'format' && tag.subcategoryId === 'media' && tag.canonicalName === '配信';
      }),
      isCollaboration: [...assignedTagIds].some((tagId) => {
        const tag = lookup.get(tagId);
        return tag?.categoryId === 'context' && tag.subcategoryId === 'participation' && tag.canonicalName === 'コラボ';
      }),
      isSubjectChannel: channelTagIds.some((tagId) => subjectChannelTagIds.has(tagId)),
      isExternalPersonChannel: channelTagIds.some((tagId) => {
        const personTagId = personByChannel.get(tagId);
        return personTagId !== undefined && personTagId !== subjectPersonTagId;
      }),
    };
  });
  const subjectStreams = scoped.filter((item) => item.isStream && item.isSubjectChannel);
  const findings: ParallelGamePerspective[] = [];

  for (const candidate of scoped) {
    if (
      !candidate.isStream
      || !candidate.isCollaboration
      || !candidate.isExternalPersonChannel
      || candidate.gameTitleTagIds.length === 0
      || candidate.video.durationSeconds === null
    ) continue;

    let bestMatch: ParallelGamePerspective | undefined;
    for (const subject of subjectStreams) {
      if (subject.video.durationSeconds === null) continue;
      const sharedGameTitleTagId = candidate.gameTitleTagIds
        .find((tagId) => subject.gameTitleTagIds.includes(tagId));
      if (!sharedGameTitleTagId) continue;
      const overlapSeconds = overlap(
        candidate.video.publishedAt,
        candidate.video.durationSeconds,
        subject.video.publishedAt,
        subject.video.durationSeconds,
      );
      if (overlapSeconds < minimumParallelPerspectiveOverlapSeconds) continue;
      const finding = {
        videoId: candidate.video.videoId,
        preferredVideoId: subject.video.videoId,
        gameTitleTagId: sharedGameTitleTagId,
        overlapSeconds,
      };
      if (
        !bestMatch
        || finding.overlapSeconds > bestMatch.overlapSeconds
        || (finding.overlapSeconds === bestMatch.overlapSeconds
          && finding.preferredVideoId.localeCompare(bestMatch.preferredVideoId) < 0)
      ) bestMatch = finding;
    }
    if (bestMatch) findings.push(bestMatch);
  }

  return findings.sort((left, right) => left.videoId.localeCompare(right.videoId));
}

function overlap(
  leftPublishedAt: string,
  leftDurationSeconds: number,
  rightPublishedAt: string,
  rightDurationSeconds: number,
): number {
  const leftStart = Date.parse(leftPublishedAt) / 1000;
  const rightStart = Date.parse(rightPublishedAt) / 1000;
  return Math.max(0, Math.min(
    leftStart + leftDurationSeconds,
    rightStart + rightDurationSeconds,
  ) - Math.max(leftStart, rightStart));
}
