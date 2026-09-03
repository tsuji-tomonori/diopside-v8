export type CollaborationAuditVideo = {
  videoId: string;
  title: string;
  tagAssignments: ReadonlyArray<{ tagId: string; reason?: string }>;
  timestamps?: {
    status: string;
    items?: ReadonlyArray<{ label: string }>;
  };
};

export type CollaborationAuditGroup = {
  tagId: string;
  name: string;
  memberTagIds: readonly string[];
};

export type CollaborationAuditPerson = {
  tagId: string;
  name: string;
};

export type CollaborationAuditAlias = {
  alias: string;
  tagId: string;
};

export type CollaborationAuditSource = {
  subjectPerformerTagId: string;
  collaborationTagId: string;
  confirmedAppearances: ReadonlyArray<{ videoId: string; groupTagId: string }>;
  confirmedParticipants: ReadonlyArray<{ videoId: string; performerTagIds: readonly string[] }>;
  excludedAppearances: ReadonlyArray<{ videoId: string; groupTagId: string; reason: string }>;
  confirmedLegacyPerformers: ReadonlyArray<{
    videoId: string;
    performerTagId: string;
    reason: string;
  }>;
  excludedPerformers: ReadonlyArray<{
    videoId: string;
    performerTagId: string;
    reason: string;
  }>;
  requiredPerformers: ReadonlyArray<{
    videoId: string;
    performerTagId: string;
    reason: string;
  }>;
};

export type CollaborationAuditResult = {
  errors: string[];
  appearances: ReadonlyArray<{ videoId: string; groupTagId: string; origin: 'title' | 'confirmed' }>;
  explicitAppearanceCount: number;
  confirmedAppearanceCount: number;
  auditedAppearanceCount: number;
  confirmedParticipantVideoCount: number;
  confirmedParticipantCount: number;
  auditedLegacyPerformerCount: number;
  confirmedLegacyPerformerCount: number;
  excludedPerformerCount: number;
  requiredPerformerCount: number;
};

const normalizeForMatch = (value: string): string => value
  .normalize('NFKC')
  .toLocaleLowerCase('ja-JP')
  .replace(/^#+/u, '')
  .replace(/\s+/gu, ' ')
  .trim();

const appearanceKey = (videoId: string, groupTagId: string): string => `${videoId}\u0000${groupTagId}`;
const performerKey = (videoId: string, performerTagId: string): string => `${videoId}\u0000${performerTagId}`;
const legacyPerformerReasonPrefix = '既存出演者タグ';

export const auditCollaborationGroupTags = ({
  videos,
  people,
  groups,
  aliases,
  source,
}: {
  videos: readonly CollaborationAuditVideo[];
  people: readonly CollaborationAuditPerson[];
  groups: readonly CollaborationAuditGroup[];
  aliases: readonly CollaborationAuditAlias[];
  source: CollaborationAuditSource;
}): CollaborationAuditResult => {
  const errors: string[] = [];
  const videosById = new Map(videos.map((video) => [video.videoId, video]));
  const peopleById = new Map(people.map((person) => [person.tagId, person]));
  const groupsById = new Map(groups.map((group) => [group.tagId, group]));
  const aliasesByTagId = new Map<string, string[]>();
  for (const alias of aliases) {
    if (!groupsById.has(alias.tagId) && !peopleById.has(alias.tagId)) continue;
    const current = aliasesByTagId.get(alias.tagId) ?? [];
    current.push(alias.alias);
    aliasesByTagId.set(alias.tagId, current);
  }

  const excluded = new Set(source.excludedAppearances.map((item) => appearanceKey(item.videoId, item.groupTagId)));
  const expected = new Map<string, { videoId: string; groupTagId: string; origin: 'title' | 'confirmed' }>();
  let explicitAppearanceCount = 0;

  for (const video of videos) {
    const normalizedTitle = normalizeForMatch(video.title);
    for (const group of groups) {
      const needles = [group.name, ...(aliasesByTagId.get(group.tagId) ?? [])]
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

  for (const item of source.confirmedParticipants) {
    const video = videosById.get(item.videoId);
    if (!video) {
      errors.push(`${item.videoId}:確認済み出演者の動画が正本にありません。`);
      continue;
    }
    const assigned = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
    const uniquePerformerTagIds = new Set(item.performerTagIds);
    if (uniquePerformerTagIds.size !== item.performerTagIds.length) {
      errors.push(`${item.videoId}:確認済み出演者タグが重複しています。`);
    }
    for (const performerTagId of uniquePerformerTagIds) {
      const person = peopleById.get(performerTagId);
      if (!person) {
        errors.push(`${item.videoId}:確認済み出演者 ${performerTagId} が人物プロフィール正本にありません。`);
        continue;
      }
      if (performerTagId === source.subjectPerformerTagId) {
        errors.push(`${item.videoId}:対象本人「${person.name}」をコラボ相手へ含めることはできません。`);
        continue;
      }
      if (!assigned.has(performerTagId)) {
        errors.push(`${item.videoId}:確認済み出演者「${person.name}」がありません。`);
      }
    }
    if (uniquePerformerTagIds.size > 0 && !assigned.has(source.collaborationTagId)) {
      errors.push(`${item.videoId}:確認済み出演者に必要な参加形態「コラボ」がありません。`);
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

  const confirmedLegacyPerformers = new Set(
    source.confirmedLegacyPerformers.map((item) => performerKey(item.videoId, item.performerTagId)),
  );
  let auditedLegacyPerformerCount = 0;
  for (const video of videos) {
    const assignedTagIds = new Set(video.tagAssignments.map((assignment) => assignment.tagId));
    const assignedGroupMemberTagIds = new Set(
      [...assignedTagIds].flatMap((tagId) => groupsById.get(tagId)?.memberTagIds ?? []),
    );
    const timestampLabels = video.timestamps?.status === '作成済み'
      ? (video.timestamps.items ?? []).map((item) => item.label)
      : [];
    const normalizedPublicText = normalizeForMatch([video.title, ...timestampLabels].join(' '));

    for (const assignment of video.tagAssignments) {
      if (!assignment.reason?.startsWith(legacyPerformerReasonPrefix)) continue;
      const person = peopleById.get(assignment.tagId);
      if (!person) {
        errors.push(`${video.videoId}:旧出演者タグ ${assignment.tagId} がプロフィール正本にありません。`);
        continue;
      }
      auditedLegacyPerformerCount += 1;
      const needles = [person.name, ...(aliasesByTagId.get(person.tagId) ?? [])]
        .map(normalizeForMatch)
        .filter(Boolean);
      const isPubliclyNamed = needles.some((needle) => normalizedPublicText.includes(needle));
      const isAssignedGroupMember = assignedGroupMemberTagIds.has(person.tagId);
      const isExplicitlyConfirmed = confirmedLegacyPerformers.has(performerKey(video.videoId, person.tagId));
      if (!isPubliclyNamed && !isAssignedGroupMember && !isExplicitlyConfirmed) {
        errors.push(`${video.videoId}:旧出演者タグ「${person.name}」に公開情報またはユニット構成の根拠がありません。`);
      }
    }
  }

  for (const item of source.confirmedLegacyPerformers) {
    const video = videosById.get(item.videoId);
    const person = peopleById.get(item.performerTagId);
    if (!video) {
      errors.push(`${item.videoId}:個別確認済み旧出演者の動画が正本にありません。`);
      continue;
    }
    if (!person) {
      errors.push(`${item.videoId}:個別確認済み旧出演者 ${item.performerTagId} がプロフィール正本にありません。`);
      continue;
    }
    if (!video.tagAssignments.some((assignment) => (
      assignment.tagId === person.tagId
      && assignment.reason?.startsWith(legacyPerformerReasonPrefix)
    ))) {
      errors.push(`${video.videoId}:個別確認済み旧出演者「${person.name}」が旧出演者タグとして付与されていません。`);
    }
  }

  for (const item of source.excludedPerformers) {
    const video = videosById.get(item.videoId);
    const person = peopleById.get(item.performerTagId);
    if (!video) {
      errors.push(`${item.videoId}:除外確認対象の出演者動画が正本にありません。`);
      continue;
    }
    if (!person) {
      errors.push(`${item.videoId}:除外確認対象の出演者 ${item.performerTagId} がプロフィール正本にありません。`);
      continue;
    }
    if (video.tagAssignments.some((assignment) => assignment.tagId === person.tagId)) {
      errors.push(`${video.videoId}:除外条件「${item.reason}」に反して出演者「${person.name}」が付与されています。`);
    }
  }

  for (const item of source.requiredPerformers) {
    const video = videosById.get(item.videoId);
    const person = peopleById.get(item.performerTagId);
    if (!video) {
      errors.push(`${item.videoId}:必須確認対象の出演者動画が正本にありません。`);
      continue;
    }
    if (!person) {
      errors.push(`${item.videoId}:必須確認対象の出演者 ${item.performerTagId} がプロフィール正本にありません。`);
      continue;
    }
    if (!video.tagAssignments.some((assignment) => assignment.tagId === person.tagId)) {
      errors.push(`${video.videoId}:必須出演者「${person.name}」がありません。`);
    }
  }

  return {
    errors,
    appearances: [...expected.values()],
    explicitAppearanceCount,
    confirmedAppearanceCount: source.confirmedAppearances.length,
    auditedAppearanceCount: expected.size,
    confirmedParticipantVideoCount: source.confirmedParticipants.length,
    confirmedParticipantCount: source.confirmedParticipants.reduce(
      (total, item) => total + item.performerTagIds.length,
      0,
    ),
    auditedLegacyPerformerCount,
    confirmedLegacyPerformerCount: source.confirmedLegacyPerformers.length,
    excludedPerformerCount: source.excludedPerformers.length,
    requiredPerformerCount: source.requiredPerformers.length,
  };
};
