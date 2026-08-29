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
  confirmedParticipants: [],
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
      people: [],
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
      people: [],
      aliases: [{ alias: '#にじさんじ性癖コンビ', tagId: group.tagId }],
      source,
    });

    expect(result.errors).toEqual([]);
    expect(result.auditedAppearanceCount).toBe(2);
  });

  it('確認済みの出演者集合とコラボタグを動画単位で要求する', () => {
    const result = auditCollaborationGroupTags({
      videos: [
        { videoId: 'party', title: '女子会ゲーム', tagAssignments: [{ tagId: 'performer-fumi' }] },
      ],
      groups: [],
      people: [
        { tagId: 'performer-fumi', name: 'フミ' },
        { tagId: 'performer-saori', name: '大西沙織' },
      ],
      aliases: [],
      source: {
        ...source,
        confirmedAppearances: [],
        confirmedParticipants: [{
          videoId: 'party',
          performerTagIds: ['performer-fumi', 'performer-saori'],
        }],
      },
    });

    expect(result.errors).toEqual(expect.arrayContaining([
      'party:確認済み出演者「大西沙織」がありません。',
      'party:確認済み出演者に必要な参加形態「コラボ」がありません。',
    ]));
    expect(result.confirmedParticipantVideoCount).toBe(1);
    expect(result.confirmedParticipantCount).toBe(2);
  });

  it('未登録の出演者タグを確認済み集合から拒否する', () => {
    const result = auditCollaborationGroupTags({
      videos: [{ videoId: 'party', title: '女子会ゲーム', tagAssignments: [] }],
      groups: [],
      people: [],
      aliases: [],
      source: {
        ...source,
        confirmedAppearances: [],
        confirmedParticipants: [{ videoId: 'party', performerTagIds: ['performer-unknown'] }],
      },
    });

    expect(result.errors).toContain('party:確認済み出演者 performer-unknown が人物プロフィール正本にありません。');
  });
});
