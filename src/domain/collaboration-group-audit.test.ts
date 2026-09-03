import { describe, expect, it } from 'vitest';

import { auditCollaborationGroupTags } from './collaboration-group-audit.ts';

const group = {
  tagId: 'unit-night-kingdom',
  name: '夜王国',
  memberTagIds: ['performer-fuwa', 'performer-gwel', 'performer-tomoe'],
};
const source = {
  subjectPerformerTagId: 'performer-tomoe',
  collaborationTagId: 'context-collaboration',
  confirmedAppearances: [{ videoId: 'target', groupTagId: group.tagId }],
  excludedAppearances: [{ videoId: 'solo', groupTagId: group.tagId, reason: '単独配信の言葉遊び' }],
};

describe('auditCollaborationGroupTags', () => {
  it('タイトルにユニット名がない確認済み出演でも全員分のタグを要求する', () => {
    const result = auditCollaborationGroupTags({
      videos: [
        { videoId: 'target', title: '健屋さん参戦！目指せ4逃げ！', tagAssignments: [] },
        { videoId: 'solo', title: '夜王国語を学ぶ', tagAssignments: [] },
      ],
      groups: [group],
      aliases: [],
      source,
    });

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('target:確認済み出演に対応するユニット「夜王国」'),
      expect.stringContaining('target:ユニット「夜王国」の出演者 performer-fuwa'),
      expect.stringContaining('target:ユニット「夜王国」の出演者 performer-gwel'),
    ]));
  });

  it('別名を含む公開タイトルと確認済み出演を監査し、除外を維持する', () => {
    const completeTags = [group.tagId, 'performer-fuwa', 'performer-gwel', 'context-collaboration']
      .map((tagId) => ({ tagId }));
    const result = auditCollaborationGroupTags({
      videos: [
        { videoId: 'target', title: '健屋さん参戦！目指せ4逃げ！', tagAssignments: completeTags },
        { videoId: 'alias', title: '＃にじさんじ性癖コンビ', tagAssignments: completeTags },
        { videoId: 'solo', title: '夜王国語を学ぶ', tagAssignments: [] },
      ],
      groups: [group],
      aliases: [{ alias: '#にじさんじ性癖コンビ', tagId: group.tagId }],
      source,
    });

    expect(result.errors).toEqual([]);
    expect(result.auditedAppearanceCount).toBe(2);
  });
});
