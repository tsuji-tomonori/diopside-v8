import { useEffect, useId, useMemo, useState } from 'react';

import type { WordCloudInputType } from '../../domain/content.ts';

import { buildWordCloudLayout, wordCloudViewBoxes, type WordCloudInputWord } from './wordCloudLayout.ts';

interface WordCloudProps {
  inputType: WordCloudInputType;
  words: readonly WordCloudInputWord[];
}

const compactMediaQuery = '(max-width: 620px)';

export function WordCloud({ inputType, words }: WordCloudProps): React.JSX.Element {
  const compact = useCompactLayout();
  const mode = compact ? 'compact' : 'wide';
  const viewBox = wordCloudViewBoxes[mode];
  const positionedWords = useMemo(() => buildWordCloudLayout(words, mode), [mode, words]);
  const titleId = useId();
  const descriptionId = useId();
  const audienceBased = inputType === '公開チャット' || inputType === '公開コメント';

  return (
    <figure className="word-cloud-figure">
      <figcaption className="word-cloud-context">
        <strong>{sourceLabel(inputType)}</strong>
        <span>{audienceBased ? '大きい言葉ほど、視聴者の反応が強かった言葉です' : '大きい言葉ほど、入力資料で強く現れた言葉です'}</span>
      </figcaption>
      <svg
        className="word-cloud"
        data-layout={mode}
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>ワードクラウド</title>
        <desc id={descriptionId}>重要度の高い語を大きく、縦向きと横向きを交ぜて密集配置しています。</desc>
        <g aria-hidden="true">
          {positionedWords.map((word) => (
            <text
              className={`word-cloud-color-${word.colorIndex}`}
              data-weight={word.weight}
              data-rotation={word.rotation}
              dominantBaseline="central"
              fontSize={word.fontSize}
              key={word.term}
              textAnchor="middle"
              transform={`translate(${word.x} ${word.y}) rotate(${word.rotation})`}
            >
              {word.term}
            </text>
          ))}
        </g>
      </svg>
      <ol className="screen-reader-only">
        {positionedWords.map((word) => <li key={word.term}>{word.term}、重要度{word.weight}</li>)}
      </ol>
    </figure>
  );
}

export function wordCloudEyebrow(inputType: WordCloudInputType): string {
  return inputType === '公開チャット' || inputType === '公開コメント'
    ? '視聴者コメントの盛り上がり'
    : '動画を表す言葉';
}

function sourceLabel(inputType: WordCloudInputType): string {
  const labels: Record<WordCloudInputType, string> = {
    公開チャット: '視聴者の公開チャットから抽出',
    公開コメント: '視聴者の公開コメントから抽出',
    公開字幕: '動画の公開字幕から抽出',
    公開概要欄: '動画の公開概要欄から抽出',
    運用者提供の公開本文: '運用者が確認した公開本文から抽出',
  };
  return labels[inputType];
}

function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => matchesCompactLayout());
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(compactMediaQuery);
    const update = (): void => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

function matchesCompactLayout(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(compactMediaQuery).matches
    : window.innerWidth <= 620;
}
