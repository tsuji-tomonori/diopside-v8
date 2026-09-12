import {
  Blocks,
  BookOpenText,
  Brain,
  Compass,
  Crosshair,
  Dices,
  Drama,
  Dumbbell,
  EyeOff,
  Footprints,
  Gamepad2,
  GamepadDirectional,
  Gauge,
  Ghost,
  GraduationCap,
  HandFist,
  Music2,
  PartyPopper,
  Puzzle,
  Shield,
  Skull,
  SlidersHorizontal,
  Swords,
  Trophy,
  WandSparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * 公開中のゲームジャンルを、一覧で素早く識別するための視覚モチーフです。
 * 新しいジャンルを追加したときは、その意味に合うアイコンも同時に選びます。
 */
export const GAME_GENRE_ICONS = {
  'FPS/TPS': Crosshair,
  MOBA: Swords,
  RPG: WandSparkles,
  アクション: Zap,
  アドベンチャー: Compass,
  ウォーキングシミュレーター: Footprints,
  カジュアル: Gamepad2,
  サバイバル: Shield,
  サンドボックス: Blocks,
  シミュレーション: SlidersHorizontal,
  ステルス: EyeOff,
  ストラテジー: Brain,
  スポーツ: Trophy,
  テーブルゲーム: Dices,
  パーティーゲーム: PartyPopper,
  パズル: Puzzle,
  ビジュアルノベル: BookOpenText,
  フィットネス: Dumbbell,
  プラットフォーマー: GamepadDirectional,
  ホラー: Ghost,
  リズム: Music2,
  レーシング: Gauge,
  ローグライク: Skull,
  格闘: HandFist,
  '教育・学習': GraduationCap,
  '人狼・正体隠匿': Drama,
} as const satisfies Readonly<Record<string, LucideIcon>>;

export function gameGenreIcon(canonicalName: string): LucideIcon {
  return GAME_GENRE_ICONS[canonicalName as keyof typeof GAME_GENRE_ICONS] ?? Gamepad2;
}
