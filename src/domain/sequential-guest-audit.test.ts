import { auditSequentialGuestTags, type SequentialGuestRecord } from './sequential-guest-audit.ts';

const record: SequentialGuestRecord = {
  videoId: 'guest-show', channelTagId: 'tag-people-channel-host',
  hostPerformerTagIds: ['tag-people-performer-host'], reason: '紹介相手が順番に交代する',
  evidenceUrls: ['https://www.youtube.com/watch?v=guest-show'],
};
const mappings = [{ channelTagId: record.channelTagId, personTagId: record.hostPerformerTagIds[0]! }];
const video = (tags: string[]) => ({
  videoId: record.videoId, title: '企画', tagAssignments: tags.map((tagId) => ({ tagId })),
});
const valid = [record.channelTagId, ...record.hostPerformerTagIds];

describe('ゲスト交代企画の人物タグ監査', () => {
  it('主催者のみの分類を許容し、紹介名をタイムスタンプから再追加しない', () => {
    expect(auditSequentialGuestTags([{ ...video(valid), timestamps: {
      status: '作成済み', items: [{ label: '白雪巴の登場' }, { label: '別ゲストの紹介' }],
    } }], [record], mappings)).toEqual([]);
  });
  it.each(['tag-people-performer-guest', 'tag-people-unit-duo'])(
    '他ゲスト・ユニットの再混入を拒否する: %s', (tag) => {
      expect(auditSequentialGuestTags([video([...valid, tag])], [record], mappings)).toHaveLength(1);
    },
  );
  it('主催者の欠落と別チャンネルへの誤対応を拒否する', () => {
    expect(auditSequentialGuestTags([video([record.channelTagId])], [record], mappings)).toHaveLength(1);
    expect(auditSequentialGuestTags([video(valid)], [{ ...record, channelTagId: 'wrong' }], mappings)).not.toEqual([]);
  });
  it('同時参加する通常ゲームコラボは人物を削らない', () => {
    expect(auditSequentialGuestTags([video([...valid, 'tag-people-performer-player'])], [], mappings)).toEqual([]);
  });
  it('確認済みの団体公式チャンネルはチャンネルタグだけを残す', () => {
    const group = { ...record, hostKind: 'group-channel' as const, hostPerformerTagIds: [] };
    const owners = [{ channelTagId: record.channelTagId, evidenceUrls: record.evidenceUrls }];
    expect(auditSequentialGuestTags([video([record.channelTagId])], [group], [], owners)).toEqual([]);
    expect(auditSequentialGuestTags([video([...valid])], [group], [], owners)).not.toEqual([]);
  });
  it('団体扱いによる個人チャンネルの主催者省略を拒否する', () => {
    const group = { ...record, hostKind: 'group-channel' as const, hostPerformerTagIds: [] };
    const owners = [{ channelTagId: record.channelTagId, evidenceUrls: record.evidenceUrls }];
    expect(auditSequentialGuestTags([video([record.channelTagId])], [group], mappings, owners)).not.toEqual([]);
  });
  it('団体チャンネルの根拠なし例外を拒否する', () => {
    const group = { ...record, hostKind: 'group-channel' as const, hostPerformerTagIds: [] };
    expect(auditSequentialGuestTags([video([record.channelTagId])], [group], [])).not.toEqual([]);
    expect(auditSequentialGuestTags([video([record.channelTagId])], [group], [], [{ channelTagId: record.channelTagId, evidenceUrls: [] }])).not.toEqual([]);
  });
  it('重複判定、動画欠落、根拠欠落を拒否する', () => {
    expect(auditSequentialGuestTags([video(valid)], [record, record], mappings)).toHaveLength(1);
    expect(auditSequentialGuestTags([], [record], mappings)).toHaveLength(1);
    expect(auditSequentialGuestTags([video(valid)], [{ ...record, evidenceUrls: [] }], mappings)).toHaveLength(1);
  });
});
