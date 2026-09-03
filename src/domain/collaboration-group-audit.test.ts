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
  confirmedLegacyPerformers: [],
  excludedPerformers: [],
  requiredPerformers: [],
};
const people = [
  { tagId: 'performer-fuwa', name: '不破湊' },
  { tagId: 'performer-gwel', name: 'グウェル・オス・ガール' },
  { tagId: 'performer-tomoe', name: '白雪巴' },
];

describe('auditCollaborationGroupTags', () => {
  it('タイトルにユニット名がない確認済み出演でも全員分のタグを要求する', () => {
    const result = auditCollaborationGroupTags({
      videos: [
        { videoId: 'target', title: '健屋さん参戦！目指せ4逃げ！', tagAssignments: [] },
        { videoId: 'solo', title: '夜王国語を学ぶ', tagAssignments: [] },
      ],
      people,
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
      people,
      groups: [group],
      aliases: [{ alias: '#にじさんじ性癖コンビ', tagId: group.tagId }],
      source,
    });

    expect(result.errors).toEqual([]);
    expect(result.auditedAppearanceCount).toBe(2);
  });

  it('公開情報にも付与済みユニットにも根拠がない旧出演者タグを拒否する', () => {
    const snowbell = {
      tagId: 'unit-snowbell',
      name: 'スノーベル',
      memberTagIds: ['performer-belmond', 'performer-tomoe'],
    };
    const result = auditCollaborationGroupTags({
      videos: [{
        videoId: 'DhawDr_VJdk',
        title: '事故物件を大人2人で掃除します【#スノーベル】',
        tagAssignments: [
          { tagId: snowbell.tagId },
          { tagId: 'performer-sukoya', reason: '既存出演者タグ「健屋花那」を確認' },
        ],
      }],
      people: [
        ...people,
        { tagId: 'performer-belmond', name: 'ベルモンド・バンデラス' },
        { tagId: 'performer-sukoya', name: '健屋花那' },
      ],
      groups: [snowbell],
      aliases: [],
      source: {
        ...source,
        confirmedAppearances: [],
        excludedAppearances: [],
      },
    });

    expect(result.errors).toContain('DhawDr_VJdk:旧出演者タグ「健屋花那」に公開情報またはユニット構成の根拠がありません。');
  });

  it('個別確認した旧出演者を許可し、除外出演者と必須出演者を監査する', () => {
    const detective = { tagId: 'performer-detective', name: 'シェリン・バーガンディ' };
    const kisara = { tagId: 'performer-kisara', name: '綺沙良' };
    const result = auditCollaborationGroupTags({
      videos: [
        {
          videoId: 'ambiguous',
          title: '探偵さんとマリカ対決',
          tagAssignments: [{
            tagId: detective.tagId,
            reason: '既存出演者タグ「シェリン・バーガンディ」を確認',
          }],
        },
        { videoId: 'corrected', title: '綺沙良さんと同時視聴', tagAssignments: [{ tagId: kisara.tagId }] },
        { videoId: 'excluded', title: '別の相手との配信', tagAssignments: [] },
      ],
      people: [...people, detective, kisara],
      groups: [],
      aliases: [],
      source: {
        ...source,
        confirmedAppearances: [],
        excludedAppearances: [],
        confirmedLegacyPerformers: [{
          videoId: 'ambiguous',
          performerTagId: detective.tagId,
          reason: '公開タイトルの「探偵さん」と配信情報から本人を確認',
        }],
        excludedPerformers: [{
          videoId: 'excluded',
          performerTagId: detective.tagId,
          reason: '公開参加者に含まれない',
        }],
        requiredPerformers: [{
          videoId: 'corrected',
          performerTagId: kisara.tagId,
          reason: '公開タイトルに明記',
        }],
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.auditedLegacyPerformerCount).toBe(1);
    expect(result.confirmedLegacyPerformerCount).toBe(1);
  });

  it('除外対象の誤出演者と欠落した必須出演者を拒否する', () => {
    const wrong = { tagId: 'performer-wrong', name: '誤出演者' };
    const required = { tagId: 'performer-required', name: '正しい出演者' };
    const result = auditCollaborationGroupTags({
      videos: [{
        videoId: 'correction',
        title: '正しい出演者との配信',
        tagAssignments: [{ tagId: wrong.tagId }],
      }],
      people: [...people, wrong, required],
      groups: [],
      aliases: [],
      source: {
        ...source,
        confirmedAppearances: [],
        excludedAppearances: [],
        excludedPerformers: [{
          videoId: 'correction',
          performerTagId: wrong.tagId,
          reason: '公開参加者に含まれない',
        }],
        requiredPerformers: [{
          videoId: 'correction',
          performerTagId: required.tagId,
          reason: '公開タイトルに明記',
        }],
      },
    });

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('除外条件「公開参加者に含まれない」'),
      expect.stringContaining('必須出演者「正しい出演者」がありません'),
    ]));
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
