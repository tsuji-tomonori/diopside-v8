import { selectCollaboratorNames, type CollaborationCandidate } from './collaboration.ts';

const candidates: CollaborationCandidate[] = [
  { name: '白雪巴', isSubject: true, isHost: false, isFixedRadioPartner: false },
  { name: '配信主', isSubject: false, isHost: true, isFixedRadioPartner: true },
  { name: '固定共演者', isSubject: false, isHost: false, isFixedRadioPartner: true },
  { name: '単発ゲスト', isSubject: false, isHost: false, isFixedRadioPartner: false },
];

describe('コラボ相手の選別', () => {
  it('通常コラボは本人を除く実出演者を採る', () => {
    expect(selectCollaboratorNames(candidates, 'all-partners')).toEqual(['固定共演者', '単発ゲスト', '配信主']);
  });

  it('凸待ち・逆凸は配信主だけを採る', () => {
    expect(selectCollaboratorNames(candidates, 'call-in-host-only')).toEqual(['配信主']);
  });

  it('ゲスト交代・順次紹介企画は他の紹介対象を除いてチャンネル主だけを採る', () => {
    expect(selectCollaboratorNames(candidates, 'sequential-guest-host-only')).toEqual(['配信主']);
  });

  it('継続ラジオは固定の相手だけを採り単発ゲストを除く', () => {
    expect(selectCollaboratorNames(candidates, 'regular-radio-fixed-partners-only')).toEqual(['固定共演者', '配信主']);
  });
});
