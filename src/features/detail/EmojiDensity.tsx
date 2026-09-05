import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { PublicVideoDetail } from '../../domain/content.ts';
import { formatTimestamp } from '../../format.ts';

type Usage = NonNullable<PublicVideoDetail['customEmojiUsage']>;
type Timeline = NonNullable<Usage['timeline']>;

export function EmojiDensity({ usage, timeline, videoId, timestamps }: {
  usage: Usage; timeline: Timeline; videoId: string; timestamps: PublicVideoDetail['timestamps'];
}): React.JSX.Element {
  const n = timeline.bins.length;
  const [range, setRange] = useState<[number, number]>([0, timeline.durationSeconds]);
  const dragging = useRef<'start' | 'end' | null>(null);
  const [start, end] = range;
  const lo = Math.floor(start / 60);
  const hi = Math.ceil(end / 60) - 1;
  const countedSeconds = Math.min(timeline.durationSeconds, (hi + 1) * 60) - lo * 60;
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
  function moveBoundary(boundary: 'start' | 'end', seconds: number): void {
    setRange(([from, to]) => boundary === 'start'
      ? [Math.max(0, Math.min(to - 1, Math.round(seconds))), to]
      : [from, Math.min(timeline.durationSeconds, Math.max(from + 1, Math.round(seconds)))]);
  }
  function pointerSeconds(event: PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    return (event.clientX - rect.left) / rect.width * timeline.durationSeconds;
  }
  function beginDrag(event: PointerEvent<HTMLDivElement>): void {
    if (!event.isPrimary || event.button !== 0) return;
    const handle = (event.target as Element).closest<HTMLElement>('[data-boundary]');
    const seconds = pointerSeconds(event);
    const boundary = handle?.dataset.boundary === 'start' || handle?.dataset.boundary === 'end'
      ? handle.dataset.boundary : Math.abs(seconds - start) <= Math.abs(seconds - end) ? 'start' : 'end';
    dragging.current = boundary;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.querySelector<HTMLElement>(`[data-boundary="${boundary}"]`)?.focus({ preventScroll: true });
    if (!handle) moveBoundary(boundary, seconds);
    event.preventDefault();
  }
  function keyboardMove(event: KeyboardEvent<HTMLDivElement>, boundary: 'start' | 'end'): void {
    const current = boundary === 'start' ? start : end;
    const changes: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -60, PageUp: 60 };
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? timeline.durationSeconds
      : changes[event.key] !== undefined ? current + changes[event.key]! : undefined;
    if (next === undefined) return;
    event.preventDefault();
    moveBoundary(boundary, next);
  }

  return (
    <div className="emoji-density">
      <h3>絵文字の波</h3>
      <p className="notice">棒の高さは1分あたりの使用回数（3分ごとに表示）。縦線は章の境目です。</p>
      <p className="emoji-range-hint" id={`emoji-range-help-${videoId}`}>左右のつまみをドラッグして範囲を選択。矢印キーで1秒、Page Up / Downで1分調整できます。</p>
      <div className="emoji-wave-scroll" role="group" aria-label="絵文字の範囲選択">
        <div className="emoji-wave" onPointerDown={beginDrag}
          onPointerMove={(event) => { if (dragging.current) moveBoundary(dragging.current, pointerSeconds(event)); }}
          onPointerUp={(event) => {
            if (dragging.current) moveBoundary(dragging.current, pointerSeconds(event));
            dragging.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { dragging.current = null; }}
          onLostPointerCapture={() => { dragging.current = null; }}>
          <div className="emoji-wave-bars" role="img" aria-label={`全編の絵文字密度。再生時間内 ${allPositioned.toLocaleString('ja-JP')}回。最大 ${maxDensity.toFixed(1)}回/分。下の区間選択で詳しい数値を確認できます。`}>
            {bars.map((bar) => (
              <span key={bar.start} className={bar.start < end && bar.start + bar.seconds > start ? 'selected' : ''}
                style={{ width: `${bar.seconds / timeline.durationSeconds * 100}%`, height: `${bar.density / maxDensity * 100}%` }} />
            ))}
          </div>
          <div className="emoji-chapter-markers" aria-hidden="true">
            {chapters.filter((chapter) => chapter.startSeconds < timeline.durationSeconds).map((chapter) => <span key={chapter.timestampId} title={chapter.label} style={{ left: `${chapter.startSeconds / timeline.durationSeconds * 100}%` }} />)}
          </div>
          <div className="emoji-wave-selection" aria-hidden="true" style={{ left: `${start / timeline.durationSeconds * 100}%`, width: `${(end - start) / timeline.durationSeconds * 100}%` }} />
          {(['start', 'end'] as const).map((boundary) => {
            const value = boundary === 'start' ? start : end;
            return <div key={boundary} className="emoji-range-handle" data-boundary={boundary}
              role="slider" tabIndex={0} aria-label={boundary === 'start' ? '区間の開始' : '区間の終了'}
              aria-valuemin={boundary === 'start' ? 0 : start + 1}
              aria-valuemax={boundary === 'start' ? end - 1 : timeline.durationSeconds}
              aria-valuenow={value} aria-valuetext={formatTimestamp(value)}
              aria-describedby={`emoji-range-help-${videoId}`}
              onKeyDown={(event) => keyboardMove(event, boundary)}
              style={{ left: `${value / timeline.durationSeconds * 100}%` }}><span aria-hidden="true">Ⅱ</span></div>;
          })}
        </div>
        <div className="emoji-wave-axis"><span>0:00</span><span>{formatTimestamp(timeline.durationSeconds)}</span></div>
      </div>
      <div className="emoji-range-card">
        <div className="emoji-range-inputs">
          <label>開始（秒）<input type="number" min={0} max={end - 1} step={1} aria-label="区間の開始（秒）" value={start}
            onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) moveBoundary('start', event.target.valueAsNumber); }} /></label>
          <label>終了（秒）<input type="number" min={start + 1} max={timeline.durationSeconds} step={1} aria-label="区間の終了（秒）" value={end}
            onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) moveBoundary('end', event.target.valueAsNumber); }} /></label>
        </div>
        <div aria-live="polite" aria-atomic="true">
          <h4>{formatTimestamp(start)}–{formatTimestamp(end)}</h4>
          {inChapters.length ? <p className="emoji-range-chapters">{inChapters.slice(0, 2).map((item) => item.label).join(' / ')}{inChapters.length > 2 ? ` 他${inChapters.length - 2}章` : ''}</p> : null}
          <p className="emoji-range-count">集計範囲で {count.toLocaleString('ja-JP')}回 ・ 再生時間内の{(allPositioned ? count / allPositioned * 100 : 0).toFixed(1)}%</p>
          <p className="notice">回数・内訳は重なる1分区間の集計です（{formatTimestamp(lo * 60)}–{formatTimestamp(Math.min(timeline.durationSeconds, (hi + 1) * 60))}）。平均 {(count * 60 / countedSeconds).toFixed(1)}回/分</p>
          {count === 0 ? <p>この区間はカスタム絵文字が0回です。</p> : null}
        </div>
        <ul className="emoji-range-pills" aria-label="選択区間の絵文字別使用回数" tabIndex={0}>
          {top.map((item) => <li key={item.customEmojiId}>
            <EmojiIcon item={item} /><code>{item.label}</code><strong>{item.count.toLocaleString('ja-JP')}回</strong>
          </li>)}
        </ul>
        <a className="button primary" href={url(start)} target="_blank" rel="noreferrer">区間の頭 {formatTimestamp(start)} から見る</a>
        {count > 0 ? <a className="button secondary" href={url(Math.max(start, peak * 60))} target="_blank" rel="noreferrer">一番濃い {formatTimestamp(Math.max(start, peak * 60))} へ</a> : null}
        <div className="emoji-range-actions">
          <button type="button" disabled={start === 0 && end === timeline.durationSeconds} onClick={() => setRange([Math.max(0, start - 60), Math.min(timeline.durationSeconds, end + 60)])}>前後1分に広げる</button>
          <button type="button" disabled={count === 0} onClick={() => setRange([Math.max(start, peak * 60), Math.min(end, (peak + 1) * 60)])}>ピークの1分に絞る</button>
          <button type="button" onClick={() => setRange([0, timeline.durationSeconds])}>全体を選択</button>
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
