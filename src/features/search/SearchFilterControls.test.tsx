import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import type { DurationBucket } from '../../domain/search.ts';
import { DateRangePicker } from './DateRangePicker.tsx';
import { DurationRangeSlider } from './DurationRangeSlider.tsx';

describe('検索フィルターUI', () => {
  it('カレンダー上の2日を開始・終了として選び、範囲を一つの表示にまとめる', () => {
    render(<ControlledDateRange />);

    fireEvent.click(screen.getByRole('button', { name: /公開日の範囲/u }));
    fireEvent.click(screen.getByRole('button', { name: '2026年12月3日' }));
    expect(screen.getByText('終了日を選んでください')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '2026年12月10日' }));

    expect(screen.getByRole('button', { name: /公開日の範囲/u })).toHaveTextContent('2026/12/3 — 2026/12/10');
    expect(screen.getByRole('button', { name: '2026年12月3日、開始日' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2026年12月10日、終了日' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('公開日のプリセットと直接入力を同じ期間選択へ反映する', () => {
    render(<ControlledDateRange />);
    fireEvent.click(screen.getByRole('button', { name: /公開日の範囲/u }));
    fireEvent.click(screen.getByRole('button', { name: '過去30日' }));

    expect(screen.getByLabelText('開始日')).toHaveValue('2026-12-02');
    expect(screen.getByLabelText('終了日')).toHaveValue('2026-12-31');
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-10-01' } });
    expect(screen.getByRole('button', { name: /公開日の範囲/u })).toHaveTextContent('2026/10/1 — 2026/12/31');
  });

  it('動画長を二つのrange入力と既存区分のクイック選択で変更する', () => {
    render(<ControlledDurationRange />);
    const minimum = screen.getByLabelText('最小（分）');
    const maximum = screen.getByLabelText('最大（分）');
    expect(minimum).toHaveAttribute('type', 'range');
    expect(maximum).toHaveAttribute('type', 'range');

    fireEvent.change(minimum, { target: { value: '90' } });
    fireEvent.change(maximum, { target: { value: '150' } });
    expect(screen.getByText('1時間30分 — 2時間30分')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '30分〜1時間' }));
    expect(screen.getByText('30分以上1時間未満')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '指定なし' }));
    expect(screen.getByText('すべての動画長')).toBeVisible();
  });
});

function ControlledDateRange(): React.JSX.Element {
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  return (
    <DateRangePicker
      from={range.from}
      to={range.to}
      minimumAvailableDate="2026-01-01"
      maximumAvailableDate="2026-12-31"
      onChange={setRange}
    />
  );
}

function ControlledDurationRange(): React.JSX.Element {
  const [condition, setCondition] = useState<{
    bucket?: DurationBucket;
    minimumMinutes?: number;
    maximumMinutes?: number;
  }>({});
  return (
    <DurationRangeSlider
      bucket={condition.bucket}
      minimumMinutes={condition.minimumMinutes}
      maximumMinutes={condition.maximumMinutes}
      limitMinutes={240}
      onBucketChange={(bucket) => setCondition(bucket ? { bucket } : {})}
      onRangeChange={(minimumMinutes, maximumMinutes) => setCondition({
        ...(minimumMinutes !== undefined ? { minimumMinutes } : {}),
        ...(maximumMinutes !== undefined ? { maximumMinutes } : {}),
      })}
    />
  );
}
