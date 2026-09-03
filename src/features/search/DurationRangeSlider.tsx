import { durationBuckets, type DurationBucket } from '../../domain/search.ts';

interface DurationRangeSliderProps {
  bucket: DurationBucket | undefined;
  minimumMinutes: number | undefined;
  maximumMinutes: number | undefined;
  limitMinutes: number;
  onBucketChange: (bucket?: DurationBucket) => void;
  onRangeChange: (minimumMinutes?: number, maximumMinutes?: number) => void;
}

export function DurationRangeSlider({
  bucket,
  minimumMinutes,
  maximumMinutes,
  limitMinutes,
  onBucketChange,
  onRangeChange,
}: DurationRangeSliderProps): React.JSX.Element {
  const selectedBucket = durationBuckets.find((item) => item.label === bucket);
  const effectiveLimit = Math.max(1, limitMinutes, roundUp(maximumMinutes ?? 0, 30));
  const minimumPosition = clamp(
    selectedBucket?.minSeconds !== undefined ? Math.floor(selectedBucket.minSeconds / 60) : minimumMinutes ?? 0,
    0,
    effectiveLimit,
  );
  const maximumPosition = clamp(
    selectedBucket?.maxSeconds !== undefined ? Math.ceil((selectedBucket.maxSeconds + 1) / 60) : maximumMinutes ?? effectiveLimit,
    minimumPosition,
    effectiveLimit,
  );
  const left = (minimumPosition / effectiveLimit) * 100;
  const right = 100 - (maximumPosition / effectiveLimit) * 100;
  const active = Boolean(bucket || minimumMinutes !== undefined || maximumMinutes !== undefined);

  const updateMinimum = (value: number): void => {
    const nextMinimum = Math.min(value, maximumPosition);
    onRangeChange(nextMinimum > 0 ? nextMinimum : undefined, maximumPosition < effectiveLimit ? maximumPosition : undefined);
  };

  const updateMaximum = (value: number): void => {
    const nextMaximum = Math.max(value, minimumPosition);
    onRangeChange(minimumPosition > 0 ? minimumPosition : undefined, nextMaximum < effectiveLimit ? nextMaximum : undefined);
  };

  return (
    <div className="duration-slider-control">
      <div className="duration-presets" aria-label="動画長のクイック選択">
        <button type="button" aria-pressed={!active} onClick={() => onBucketChange(undefined)}>指定なし</button>
        {durationBuckets.map((item) => (
          <button
            type="button"
            key={item.label}
            aria-pressed={bucket === item.label}
            onClick={() => onBucketChange(item.label)}
          >
            {compactBucketLabel(item.label)}
          </button>
        ))}
      </div>

      <div className="duration-range-summary" aria-live="polite">
        <span>{active ? bucket ? 'クイック範囲' : 'カスタム範囲' : 'すべての動画長'}</span>
        <strong>{formatRange(bucket, minimumMinutes, maximumMinutes)}</strong>
      </div>

      <div className="duration-slider" style={{ '--range-left': `${left}%`, '--range-right': `${right}%` } as React.CSSProperties}>
        <div className="duration-slider-track" aria-hidden="true"><span /></div>
        <input
          id="duration-minimum"
          className="duration-range-input duration-range-minimum"
          type="range"
          min="0"
          max={effectiveLimit}
          step="1"
          value={minimumPosition}
          aria-label="最小（分）"
          onChange={(event) => updateMinimum(Number(event.target.value))}
        />
        <input
          id="duration-maximum"
          className="duration-range-input duration-range-maximum"
          type="range"
          min="0"
          max={effectiveLimit}
          step="1"
          value={maximumPosition}
          aria-label="最大（分）"
          onChange={(event) => updateMaximum(Number(event.target.value))}
        />
      </div>

      <div className="duration-slider-values">
        <output htmlFor="duration-minimum">最短 <strong>{formatMinutes(minimumPosition)}</strong></output>
        <output htmlFor="duration-maximum">最長 <strong>{maximumPosition >= effectiveLimit ? '上限なし' : formatMinutes(maximumPosition)}</strong></output>
      </div>
      <p className="hint">つまみは矢印キーでも1分ずつ調整できます。</p>
    </div>
  );
}

function compactBucketLabel(bucket: DurationBucket): string {
  if (bucket === '30分未満') return '〜30分';
  if (bucket === '30分以上1時間未満') return '30分〜1時間';
  if (bucket === '1時間以上2時間未満') return '1〜2時間';
  return '2時間〜';
}

function formatRange(bucket?: DurationBucket, minimumMinutes?: number, maximumMinutes?: number): string {
  if (bucket) return bucket;
  if (minimumMinutes === undefined && maximumMinutes === undefined) return '指定なし';
  if (minimumMinutes !== undefined && maximumMinutes !== undefined) {
    return `${formatMinutes(minimumMinutes)} — ${formatMinutes(maximumMinutes)}`;
  }
  if (minimumMinutes !== undefined) return `${formatMinutes(minimumMinutes)}以上`;
  return `${formatMinutes(maximumMinutes!)}以下`;
}

function formatMinutes(value: number): string {
  if (value < 60) return `${value}分`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
}

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
