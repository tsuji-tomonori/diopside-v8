<!-- 直接編集禁止: npm run generate:design で生成 / npm run generate:design -- --check で検査 -->
# diopside v8 実装由来設計

この文書はTypeScript実装、ルート宣言、テスト、要件正本から決定的に生成した現在状態です。意図は `spec/requirements/requirements.json`、判断理由は `docs/decisions/` を正本とします。

## 実行構成

| 領域 | 実装 | 境界 |
|---|---|---|
| 公開画面 | React + TypeScript + HashRouter | GitHub Pages上の静的ファイルだけ |
| 公開データ | 正本JSONから版付きJSONを決定的生成 | `public/data/latest.json` と同一release IDだけ受理 |
| 検索 | タイトル専用正規化索引をブラウザ内処理 | 外部検索API、タグ等の文字検索混入なし |
| 端末内データ | IndexedDB、失敗時はメモリ縮退 | サーバー送信、ログイン、端末間同期なし |
| 更新運用 | 人がChatGPT／Codex画面から明示開始 | 1動画1PR、人の承認前は非公開 |

## 画面ルート

- `*`
- `/`
- `/library`
- `/video/:videoId`

## 要件正本

| 分類 | 件数 |
|---|---:|
| COST | 5 |
| DEVICE | 11 |
| DISPLAY | 11 |
| OPS | 16 |
| QUALITY | 5 |
| SAFETY | 4 |
| SEARCH | 19 |
| TAG | 35 |
| TIME | 37 |
| **合計** | **143** |

## 公開データの流れ

`content/catalog` + `content/videos`（1動画上書き）+ `content/taxonomy` → 構造・意味・公開境界検証 → release ID算出 → `public/data/releases/<release-id>` → Vite → `docs`

## TypeScript公開契約

| ファイル | 種別 | 名前 |
|---|---|---|
| `scripts/canonical-store.ts` | FunctionDeclaration | `readCanonicalVideos` |
| `scripts/legacy-content.ts` | FunctionDeclaration | `buildLegacyContext` |
| `scripts/legacy-content.ts` | InterfaceDeclaration | `ClassifiableVideo` |
| `scripts/legacy-content.ts` | FunctionDeclaration | `classifyLegacyVideo` |
| `scripts/legacy-content.ts` | InterfaceDeclaration | `LegacyContext` |
| `scripts/legacy-content.ts` | InterfaceDeclaration | `LegacyLedgerRow` |
| `scripts/legacy-content.ts` | InterfaceDeclaration | `LegacyTagVideo` |
| `scripts/legacy-content.ts` | InterfaceDeclaration | `LegacyTimestampVideo` |
| `scripts/legacy-content.ts` | InterfaceDeclaration | `LogicalTag` |
| `scripts/legacy-content.ts` | FunctionDeclaration | `normalizeLegacyGeneratedAt` |
| `scripts/legacy-content.ts` | FunctionDeclaration | `normalizeLegacyTimestampItems` |
| `scripts/legacy-content.ts` | FunctionDeclaration | `parseIsoDuration` |
| `scripts/legacy-content.ts` | FunctionDeclaration | `unresolvedLegacyTags` |
| `scripts/lib.ts` | FunctionDeclaration | `canonicalJson` |
| `scripts/lib.ts` | FunctionDeclaration | `prettyJson` |
| `scripts/lib.ts` | FunctionDeclaration | `readJson` |
| `scripts/lib.ts` | FunctionDeclaration | `sha256` |
| `scripts/source-shards.ts` | FunctionDeclaration | `readSourceShards` |
| `scripts/source-shards.ts` | FunctionDeclaration | `shardIdForKey` |
| `scripts/source-shards.ts` | InterfaceDeclaration | `SourceShardEntry` |
| `scripts/source-shards.ts` | InterfaceDeclaration | `SourceShardManifest` |
| `scripts/source-shards.ts` | FunctionDeclaration | `writeSourceShards` |
| `scripts/validate-video-pr-scope.ts` | FunctionDeclaration | `validateVideoPrScopeFiles` |
| `scripts/validate-video-pr-scope.ts` | InterfaceDeclaration | `VideoPrScopeResult` |
| `src/App.tsx` | FunctionDeclaration | `App` |
| `src/components/Header.tsx` | FunctionDeclaration | `Header` |
| `src/components/VideoCard.tsx` | FunctionDeclaration | `VideoCard` |
| `src/contexts.ts` | VariableStatement | `BundleContext` |
| `src/contexts.ts` | VariableStatement | `DeviceStoreContext` |
| `src/contexts.ts` | FunctionDeclaration | `useBundle` |
| `src/contexts.ts` | FunctionDeclaration | `useDeviceStore` |
| `src/data/deviceStore.ts` | InterfaceDeclaration | `CachedBundle` |
| `src/data/deviceStore.ts` | ClassDeclaration | `DeviceStore` |
| `src/data/deviceStore.ts` | InterfaceDeclaration | `FavoriteEntry` |
| `src/data/deviceStore.ts` | InterfaceDeclaration | `HistoryEntry` |
| `src/data/deviceStore.ts` | InterfaceDeclaration | `RecentSearchEntry` |
| `src/data/loadPublicData.ts` | TypeAliasDeclaration | `LoadFailureKind` |
| `src/data/loadPublicData.ts` | FunctionDeclaration | `loadPublicBundle` |
| `src/data/loadPublicData.ts` | FunctionDeclaration | `loadVideoDetail` |
| `src/data/loadPublicData.ts` | InterfaceDeclaration | `PublicBundle` |
| `src/data/loadPublicData.ts` | ClassDeclaration | `PublicDataError` |
| `src/domain/content.ts` | VariableStatement | `approvedTimestampMigrationReviewSchema` |
| `src/domain/content.ts` | FunctionDeclaration | `buildTaxonomyLookup` |
| `src/domain/content.ts` | TypeAliasDeclaration | `CanonicalVideo` |
| `src/domain/content.ts` | VariableStatement | `canonicalVideoSchema` |
| `src/domain/content.ts` | VariableStatement | `confidenceSchema` |
| `src/domain/content.ts` | VariableStatement | `evidenceReferenceSchema` |
| `src/domain/content.ts` | VariableStatement | `evidenceTypeSchema` |
| `src/domain/content.ts` | FunctionDeclaration | `findTagId` |
| `src/domain/content.ts` | VariableStatement | `independentReviewSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `LatestRelease` |
| `src/domain/content.ts` | VariableStatement | `latestReleaseSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicAliasIndex` |
| `src/domain/content.ts` | VariableStatement | `publicAliasIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicIndex` |
| `src/domain/content.ts` | VariableStatement | `publicIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicTagIndex` |
| `src/domain/content.ts` | VariableStatement | `publicTagIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicVideoDetail` |
| `src/domain/content.ts` | VariableStatement | `publicVideoDetailSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicVideoShard` |
| `src/domain/content.ts` | VariableStatement | `publicVideoShardSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicVideoSummary` |
| `src/domain/content.ts` | VariableStatement | `publicVideoSummarySchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `SearchIndex` |
| `src/domain/content.ts` | VariableStatement | `searchIndexSchema` |
| `src/domain/content.ts` | VariableStatement | `synopsisSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `TagAliases` |
| `src/domain/content.ts` | VariableStatement | `tagAliasesSchema` |
| `src/domain/content.ts` | VariableStatement | `tagAssignmentSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `TagTaxonomy` |
| `src/domain/content.ts` | VariableStatement | `tagTaxonomySchema` |
| `src/domain/content.ts` | InterfaceDeclaration | `TaxonomyLookupItem` |
| `src/domain/content.ts` | VariableStatement | `timestampItemSchema` |
| `src/domain/content.ts` | VariableStatement | `timestampMissingReasonSchema` |
| `src/domain/content.ts` | VariableStatement | `timestampOriginSchema` |
| `src/domain/content.ts` | FunctionDeclaration | `videoShardId` |
| `src/domain/content.ts` | VariableStatement | `wordCloudMissingReasonSchema` |
| `src/domain/search.ts` | FunctionDeclaration | `additionalTagCounts` |
| `src/domain/search.ts` | FunctionDeclaration | `applySearch` |
| `src/domain/search.ts` | FunctionDeclaration | `bucketRange` |
| `src/domain/search.ts` | InterfaceDeclaration | `ConditionError` |
| `src/domain/search.ts` | FunctionDeclaration | `countWithAdditionalTag` |
| `src/domain/search.ts` | FunctionDeclaration | `damerauLevenshtein` |
| `src/domain/search.ts` | FunctionDeclaration | `dateInJapan` |
| `src/domain/search.ts` | TypeAliasDeclaration | `DurationBucket` |
| `src/domain/search.ts` | VariableStatement | `durationBuckets` |
| `src/domain/search.ts` | FunctionDeclaration | `fuzzyDistance` |
| `src/domain/search.ts` | FunctionDeclaration | `normalizeTagAlias` |
| `src/domain/search.ts` | FunctionDeclaration | `normalizeTitleForSearch` |
| `src/domain/search.ts` | FunctionDeclaration | `parseCondition` |
| `src/domain/search.ts` | FunctionDeclaration | `resolveTagAlias` |
| `src/domain/search.ts` | InterfaceDeclaration | `SearchCondition` |
| `src/domain/search.ts` | InterfaceDeclaration | `SearchResult` |
| `src/domain/search.ts` | TypeAliasDeclaration | `SearchVideo` |
| `src/domain/search.ts` | FunctionDeclaration | `serializeCondition` |
| `src/domain/search.ts` | TypeAliasDeclaration | `SortOrder` |
| `src/domain/search.ts` | FunctionDeclaration | `tagCountsForResults` |
| `src/domain/search.ts` | FunctionDeclaration | `tokenizeQuery` |
| `src/domain/search.ts` | FunctionDeclaration | `validateCondition` |
| `src/domain/validation.ts` | FunctionDeclaration | `scanPublicBoundary` |
| `src/domain/validation.ts` | FunctionDeclaration | `validateCanonicalVideo` |
| `src/domain/validation.ts` | FunctionDeclaration | `validateTaxonomy` |
| `src/domain/validation.ts` | InterfaceDeclaration | `ValidationIssue` |
| `src/features/detail/VideoDetailPage.tsx` | FunctionDeclaration | `VideoDetailPage` |
| `src/features/library/DeviceLibraryPage.tsx` | FunctionDeclaration | `DeviceLibraryPage` |
| `src/features/search/SearchPage.tsx` | FunctionDeclaration | `SearchPage` |
| `src/format.ts` | FunctionDeclaration | `formatDate` |
| `src/format.ts` | FunctionDeclaration | `formatDuration` |
| `src/format.ts` | FunctionDeclaration | `formatTimestamp` |
| `src/generated/release.ts` | VariableStatement | `embeddedReleaseId` |

## 自動試験

- `e2e/detail.spec.ts`
- `e2e/library.spec.ts`
- `e2e/search.spec.ts`
- `src/data/deviceStore.test.ts`
- `src/data/loadPublicData.test.ts`
- `src/domain/search.test.ts`
- `src/domain/validation.test.ts`

## 入力指紋

machine-readableな完全一覧は `inventory.gen.json` に保存します。入力39ファイル、公開契約111件です。
