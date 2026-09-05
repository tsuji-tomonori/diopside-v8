import { useMemo, useState } from 'react';
import type { PublicVideoDetail } from '../../domain/content.ts';
import { formatTimestamp } from '../../format.ts';

type Usage = NonNullable<PublicVideoDetail['customEmojiUsage']>;
type Timeline = NonNullable<Usage['timeline']>;

export function EmojiDensity({ usage, timeline, videoId, timestamps }: {
  usage: Usage; timeline: Timeline; videoId: string; timestamps: PublicVideoDetail['timestamps'];
}): React.JSX.Element {
  const n = timeline.bins.length;
  const [range, setRange] = useState<[number, number]>([0, Math.min(14, n - 1)]);
  const [pending, setPending] = useState<number | null>(null);
  const [lo, hi] = range;
  const start = lo * 60;
  const end = Math.min(timeline.durationSeconds, (hi + 1) * 60);
  const minuteCounts = useMemo(() => timeline.bins.map((bin) => bin.reduce((sum, pair) => sum + pair[1], 0)), [timeline]);
  const bars = useMemo(() => Array.from({ length: Math.ceil(n / 3) }, (_, i) => {
    const start = i * 180;
    const seconds = Math.min(180, timeline.durationSeconds - start);
    const count = minuteCounts.slice(i * 3, i * 3 + 3).reduce((sum, count) => sum + count, 0);
    return { start, seconds, count, density: count * 60 / seconds };
  }), [minuteCounts, n, timeline.durationSeconds]);
  const maxDensity = Math.max(1, ...bars.map((bar) => bar.density));
  const allPositioned = minuteCounts.reduce((sum, count) => sum + count, 0);
  const selectedCounts = usage.items.map(() => 0);
  for (const bin of timeline.bins.slice(lo, hi + 1)) {
    for (const [index, count] of bin) selectedCounts[index] = (selectedCounts[index] ?? 0) + count;
  }
  const count = selectedCounts.reduce((sum, count) => sum + count, 0);
  const top = usage.items.map((item, i) => ({ ...item, count: selectedCounts[i]! }))
    .filter((item) => item.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));
  const density = (i: number): number => minuteCounts[i]! * 60 / Math.min(60, timeline.durationSeconds - i * 60);
  let peak = lo;
  for (let i = lo + 1; i <= hi; i++) if (density(i) > density(peak)) peak = i;
  const chapters = timestamps.status === '作成済み' ? timestamps.items : [];
  const inChapters = chapters.filter((item) => item.startSeconds < end && item.endSeconds > start);
  const url = (seconds: number): string => `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`;
  function chooseCell(index: number): void {
    const first = index * 15;
    if (pending === null) {
      setRange([first, Math.min(first + 14, n - 1)]);
      setPending(index);
    } else {
      setRange([Math.min(pending, index) * 15, Math.min((Math.max(pending, index) + 1) * 15 - 1, n - 1)]);
      setPending(null);
    }
  }
  function updateRange(next: [number, number]): void { setRange(next); setPending(null); }

  return (
    <div className="emoji-density">
      <h3>絵文字の波</h3>
      <p className="notice">棒の高さは1分あたりの使用回数（3分ごとに表示）。縦線は章の境目です。</p>
      <p className="emoji-range-hint" role="status">{pending === null ? '15分マスを2回選んで、気になる区間を囲めます。' : '終わりのマスを選んでください。逆順でも選べます。'}</p>
      <div className="emoji-wave-scroll" role="region" aria-label="絵文字の密度グラフ" tabIndex={0}>
        <div className="emoji-wave" style={{ minWidth: Math.ceil(n / 15) * 28 }}>
          <div className="emoji-wave-bars" role="img" aria-label={`全編の絵文字密度。再生時間内 ${allPositioned.toLocaleString('ja-JP')}回。最大 ${maxDensity.toFixed(1)}回/分。下の区間選択で詳しい数値を確認できます。`}>
            {bars.map((bar) => (
              <span key={bar.start} className={bar.start < end && bar.start + bar.seconds > start ? 'selected' : ''}
                style={{ width: `${bar.seconds / timeline.durationSeconds * 100}%`, height: `${bar.density / maxDensity * 100}%` }} />
            ))}
          </div>
          <div className="emoji-chapter-markers" aria-hidden="true">
            {chapters.map((chapter) => <span key={chapter.timestampId} title={chapter.label} style={{ left: `${chapter.startSeconds / timeline.durationSeconds * 100}%` }} />)}
          </div>
          <div className="emoji-wave-cells">
            {Array.from({ length: Math.ceil(n / 15) }, (_, index) => {
              const from = index * 900, to = Math.min(timeline.durationSeconds, from + 900);
              return <button type="button" key={from} onClick={() => chooseCell(index)}
                aria-label={`区間 ${formatTimestamp(from)}–${formatTimestamp(to)}`}
                aria-pressed={from < end && to > start}
                style={{ width: `${(to - from) / timeline.durationSeconds * 100}%` }} />;
            })}
          </div>
        </div>
        <div className="emoji-wave-axis"><span>0:00</span><span>{formatTimestamp(timeline.durationSeconds)}</span></div>
      </div>
      <div className="emoji-range-card">
        <div className="emoji-range-inputs">
          <label>開始<select aria-label="区間の開始" value={lo} onChange={(event) => {
            const next = Number(event.target.value); updateRange([next, Math.max(next, hi)]);
          }}>{timeline.bins.map((_, index) => <option key={index} value={index}>{formatTimestamp(index * 60)}</option>)}</select></label>
          <label>終了<select aria-label="区間の終了" value={hi} onChange={(event) => {
            const next = Number(event.target.value); updateRange([Math.min(lo, next), next]);
          }}>{timeline.bins.map((_, index) => <option key={index} value={index}>{formatTimestamp(Math.min((index + 1) * 60, timeline.durationSeconds))}</option>)}</select></label>
        </div>
        <div aria-live="polite" aria-atomic="true">
          <h4>{formatTimestamp(start)}–{formatTimestamp(end)}</h4>
          {inChapters.length ? <p className="emoji-range-chapters">{inChapters.slice(0, 2).map((item) => item.label).join(' / ')}{inChapters.length > 2 ? ` 他${inChapters.length - 2}章` : ''}</p> : null}
          <p className="emoji-range-count">この区間で {count.toLocaleString('ja-JP')}回 ・ 再生時間内の{(allPositioned ? count / allPositioned * 100 : 0).toFixed(1)}%</p>
          <p className="notice">平均 {(count * 60 / (end - start)).toFixed(1)}回/分</p>
          {count === 0 ? <p>この区間はカスタム絵文字が0回です。</p> : null}
        </div>
        <ul className="emoji-range-pills" aria-label="選択区間の絵文字別使用回数">
          {top.map((item) => <li key={item.customEmojiId}>
            <EmojiIcon item={item} /><code>{item.label}</code><strong>{item.count.toLocaleString('ja-JP')}回</strong>
          </li>)}
        </ul>
        <a className="button primary" href={url(start)} target="_blank" rel="noreferrer">区間の頭 {formatTimestamp(start)} から見る</a>
        {count > 0 ? <a className="button secondary" href={url(peak * 60)} target="_blank" rel="noreferrer">一番濃い {formatTimestamp(peak * 60)} へ</a> : null}
        <div className="emoji-range-actions">
          <button type="button" disabled={lo === 0 && hi === n - 1} onClick={() => updateRange([Math.max(0, lo - 15), Math.min(n - 1, hi + 15)])}>前後に広げる</button>
          <button type="button" disabled={count === 0} onClick={() => updateRange([peak, peak])}>ピークの1分に絞る</button>
          <button type="button" onClick={() => updateRange([0, n - 1])}>全体を選択</button>
        </div>
      </div>
      <p className="notice">保存済みチャットの集計です。開始前 {timeline.beforeStartCount.toLocaleString('ja-JP')}回・終了後 {timeline.afterEndCount.toLocaleString('ja-JP')}回・時刻不明 {timeline.unpositionedCount.toLocaleString('ja-JP')}回は波に含めず、総使用回数に含めています。</p>
    </div>
  );
}

export function EmojiIcon({ item }: { item: Usage['items'][number] }): React.JSX.Element | null {
  const [failed, setFailed] = useState(false);
  return item.imageUrl && !failed ? <img src={item.imageUrl} width="24" height="24" alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : null;
}
