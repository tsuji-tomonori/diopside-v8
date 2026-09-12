import type { CollaborationAuditVideo } from './collaboration-group-audit.ts';

export interface SequentialGuestRecord {
  videoId: string;
  channelTagId: string;
  hostPerformerTagIds: string[];
  hostKind?: 'individual' | 'group-channel';
  reason: string;
  evidenceUrls: string[];
}

/** Roles are confirmed per video; a title keyword alone cannot establish attendance. */
export function auditSequentialGuestTags(
  videos: readonly CollaborationAuditVideo[],
  records: readonly SequentialGuestRecord[],
  channelMappings: ReadonlyArray<{ channelTagId: string; personTagId: string }>,
  groupChannelOwners: ReadonlyArray<{ channelTagId: string; evidenceUrls: string[] }> = [],
): string[] {
  const errors: string[] = [];
  const byId = new Map(videos.map((video) => [video.videoId, video]));
  const hostsByChannel = new Map(channelMappings.map((mapping) => [mapping.channelTagId, mapping.personTagId]));
  const groupChannels = new Set(groupChannelOwners.filter((owner) => owner.evidenceUrls.length > 0).map((owner) => owner.channelTagId));
  const seen = new Set<string>();
  for (const record of records) {
    const video = byId.get(record.videoId);
    if (seen.has(record.videoId)) errors.push(`${record.videoId}:ゲスト交代企画の判定が重複しています。`);
    seen.add(record.videoId);
    if (!video) {
      errors.push(`${record.videoId}:ゲスト交代企画の動画がありません。`);
      continue;
    }
    const assigned = new Set(video.tagAssignments.map((tag) => tag.tagId));
    const host = hostsByChannel.get(record.channelTagId);
    const ownerMatches = record.hostKind === 'group-channel'
      ? groupChannels.has(record.channelTagId) && !host && record.hostPerformerTagIds.length === 0
      : !!host && record.hostPerformerTagIds.length === 1 && record.hostPerformerTagIds[0] === host;
    if (!assigned.has(record.channelTagId) || !ownerMatches) {
      errors.push(`${record.videoId}:チャンネル主の対応が正本と一致しません。`);
    }
    if (!record.reason.trim() || record.evidenceUrls.length === 0) {
      errors.push(`${record.videoId}:ゲスト交代形式の判定根拠がありません。`);
    }
    for (const tagId of record.hostPerformerTagIds) {
      if (!assigned.has(tagId)) errors.push(`${record.videoId}:チャンネル主の人物タグ ${tagId} がありません。`);
    }
    for (const tagId of assigned) {
      if (tagId.startsWith('tag-people-unit-')
        || (tagId.startsWith('tag-people-performer-') && !record.hostPerformerTagIds.includes(tagId))) {
        errors.push(`${record.videoId}:ゲスト交代・順次紹介企画にチャンネル主以外の人物・グループ ${tagId} があります。`);
      }
    }
  }
  return errors;
}
