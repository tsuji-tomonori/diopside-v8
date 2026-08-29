export type CollaborationAuditVideo = {
  videoId: string;
  title: string;
  tagAssignments: ReadonlyArray<{ tagId: string }>;
};

export type CollaborationAuditGroup = {
  tagId: string;
  name: string;
  memberTagIds: readonly string[];
};

export type CollaborationAuditAlias = {
  alias: string;
  tagId: string;
};

export type CollaborationAuditSource = {
  subjectPerformerTagId: string;
  collaborationTagId: string;
  confirmedAppearances: ReadonlyArray<{ videoId: string; groupTagId: string }>;
  excludedAppearances: ReadonlyArray<{ videoId: string; groupTagId: string; reason: string }>;
};

export type CollaborationAuditResult = {
  errors: string[];
  appearances: ReadonlyArray<{ videoId: string; groupTagId: string; origin: 'title' | 'confirmed' }>;
  explicitAppearanceCount: number;
  confirmedAppearanceCount: number;
  auditedAppearanceCount: number;
};

const normalizeForMatch = (value: string): string => value
  .normalize('NFKC')
  .toLocaleLowerCase('ja-JP')
  .replace(/^#+/u, '')
  .replace(/\s+/gu, ' ')
  .trim();

const appearanceKey = (videoId: string, groupTagId: string): string => `${videoId}\u0000${groupTagId}`;

export const auditCollaborationGroupTags = ({
  videos,
  groups,
  aliases,
  source,
}: {
  videos: readonly CollaborationAuditVideo[];
  groups: readonly CollaborationAuditGroup[];
  aliases: readonly CollaborationAuditAlias[];
  source: CollaborationAuditSource;
}): CollaborationAuditResult => {
  const errors: string[] = [];
  const videosById = new Map(videos.map((video) => [video.videoId, video]));
  const groupsById = new Map(groups.map((group) => [group.tagId, group]));
  const aliasesByGroupId = new Map<string, string[]>();
  for (const alias of aliases) {
    if (!groupsById.has(alias.tagId)) continue;
    const current = aliasesByGroupId.get(alias.tagId) ?? [];
    current.push(alias.alias);
    aliasesByGroupId.set(alias.tagId, current);
  }

  const excluded = new Set(source.excludedAppearances.map((item) => appearanceKey(item.videoId, item.groupTagId)));
  const expected = new Map<string, { videoId: string; groupTagId: string; origin: 'title' | 'confirmed' }>();
  let explicitAppearanceCount = 0;

  for (const video of videos) {
    const normalizedTitle = normalizeForMatch(video.title);
    for (const group of groups) {
      const needles = [group.name, ...(aliasesByGroupId.get(group.tagId) ?? [])]
        .map(normalizeForMatch)
        .filter(Boolean);
      if (!needles.some((needle) => normalizedTitle.includes(needle))) continue;
      const key = appearanceKey(video.videoId, group.tagId);
      if (excluded.has(key)) continue;
      explicitAppearanceCount += 1;
      expected.set(key, { videoId: video.videoId, groupTagId: group.tagId, origin: 'title' });
    }
  }

  for (const item of source.confirmedAppearances) {
    if (!videosById.has(item.videoId)) {
      errors.push(`${item.videoId}:確認済み出演の動画が正本にありません。`);
      continue;
    }
    if (!groupsById.has(item.groupTagId)) {
      errors.push(`${item.videoId}:確認済み出演のユニット ${item.groupTagId} がプロフィール正本にありません。`);
      continue;
    }
    const key = appearanceKey(item.videoId, item.groupTagId);
    if (!expected.has(key)) expected.set(key, { ...item, origin: 'confirmed' });
  }

  for (const item of expected.values()) {
    const video = videosById.get(item.videoId);
    const group = groupsById.get(item.groupTagId);
    if (!video || !group) continue;
    const assigned = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
    if (!assigned.has(group.tagId)) {
      errors.push(`${video.videoId}:${item.origin === 'title' ? '公開タイトル' : '確認済み出演'}に対応するユニット「${group.name}」がありません。`);
    }
    if (!assigned.has(source.collaborationTagId)) {
      errors.push(`${video.videoId}:ユニット「${group.name}」の出演に必要な参加形態「コラボ」がありません。`);
    }
    for (const memberTagId of group.memberTagIds) {
      if (memberTagId === source.subjectPerformerTagId) continue;
      if (!assigned.has(memberTagId)) {
        errors.push(`${video.videoId}:ユニット「${group.name}」の出演者 ${memberTagId} がありません。`);
      }
    }
  }

  for (const item of source.excludedAppearances) {
    const video = videosById.get(item.videoId);
    const group = groupsById.get(item.groupTagId);
    if (!video) {
      errors.push(`${item.videoId}:除外確認対象の動画が正本にありません。`);
      continue;
    }
    if (!group) {
      errors.push(`${item.videoId}:除外確認対象のユニット ${item.groupTagId} がプロフィール正本にありません。`);
      continue;
    }
    if (video.tagAssignments.some((assignment) => assignment.tagId === group.tagId)) {
      errors.push(`${video.videoId}:除外条件「${item.reason}」に反してユニット「${group.name}」が付与されています。`);
    }
  }

  return {
    errors,
    appearances: [...expected.values()],
    explicitAppearanceCount,
    confirmedAppearanceCount: source.confirmedAppearances.length,
    auditedAppearanceCount: expected.size,
  };
};
