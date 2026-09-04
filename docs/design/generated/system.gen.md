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
| 更新運用 | 人がChatGPT／Codex画面から明示開始 | 1動画1PRは正本だけ、品質ゲート合格後に生成物だけのrelease PR |

## 画面ルート

- `*`
- `/`
- `/collaborators/:tagId`
- `/entities`
- `/entities/:entityId`
- `/games`
- `/games/genres/:tagId`
- `/groups/:tagId`
- `/library`
- `/series/:tagId`
- `/songs`
- `/songs/:tagId`
- `/video/:videoId`
- `/works/:tagId`

## 要件正本

| 分類 | 件数 |
|---|---:|
| COST | 5 |
| DEVICE | 11 |
| DISPLAY | 21 |
| INGEST | 17 |
| OPS | 26 |
| QUALITY | 5 |
| SAFETY | 5 |
| SEARCH | 22 |
| TAG | 44 |
| TIME | 37 |
| **合計** | **193** |

## 公開データの流れ

`content/catalog` + `content/videos`（1動画上書き）+ `content/taxonomy` → 1動画PRを人がmainへマージ → main品質ゲート → release ID算出 → `public/data/releases/<release-id>` → Vite → `docs` → 生成物だけのrelease PR → 人がmainへマージ → branch方式Pages build

## TypeScript公開契約

| ファイル | 種別 | 名前 |
|---|---|---|
| `scripts/aggregate-custom-emoji-usage.ts` | FunctionDeclaration | `aggregateCustomEmojiUsage` |
| `scripts/aggregate-custom-emoji-usage.ts` | InterfaceDeclaration | `CustomEmojiUsageAggregate` |
| `scripts/aggregate-custom-emoji-usage.ts` | InterfaceDeclaration | `CustomEmojiUsageItem` |
| `scripts/aggregate-word-cloud.ts` | FunctionDeclaration | `aggregateWordCloud` |
| `scripts/aggregate-word-cloud.ts` | TypeAliasDeclaration | `AudienceWordCloudInputType` |
| `scripts/aggregate-word-cloud.ts` | InterfaceDeclaration | `WordCloudCandidate` |
| `scripts/canonical-store.ts` | InterfaceDeclaration | `CanonicalStoreOptions` |
| `scripts/canonical-store.ts` | FunctionDeclaration | `readCanonicalVideos` |
| `scripts/japanese-reading.ts` | FunctionDeclaration | `createJapaneseReadingNormalizer` |
| `scripts/japanese-reading.ts` | VariableStatement | `japaneseReadingVersion` |
| `scripts/japanese-reading.ts` | InterfaceDeclaration | `ReadingOverrides` |
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
| `scripts/validate-release-pr-scope.ts` | FunctionDeclaration | `releaseGeneratedFiles` |
| `scripts/validate-release-pr-scope.ts` | FunctionDeclaration | `validateReleasePrScopeFiles` |
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
| `src/domain/collaboration-group-audit.ts` | VariableStatement | `auditCollaborationGroupTags` |
| `src/domain/collaboration-group-audit.ts` | TypeAliasDeclaration | `CollaborationAuditAlias` |
| `src/domain/collaboration-group-audit.ts` | TypeAliasDeclaration | `CollaborationAuditGroup` |
| `src/domain/collaboration-group-audit.ts` | TypeAliasDeclaration | `CollaborationAuditPerson` |
| `src/domain/collaboration-group-audit.ts` | TypeAliasDeclaration | `CollaborationAuditResult` |
| `src/domain/collaboration-group-audit.ts` | TypeAliasDeclaration | `CollaborationAuditSource` |
| `src/domain/collaboration-group-audit.ts` | TypeAliasDeclaration | `CollaborationAuditVideo` |
| `src/domain/collaboration.ts` | InterfaceDeclaration | `CollaborationCandidate` |
| `src/domain/collaboration.ts` | TypeAliasDeclaration | `CollaborationSelectionPolicy` |
| `src/domain/collaboration.ts` | FunctionDeclaration | `selectCollaboratorNames` |
| `src/domain/content.ts` | VariableStatement | `approvedTimestampMigrationReviewSchema` |
| `src/domain/content.ts` | FunctionDeclaration | `buildTaxonomyLookup` |
| `src/domain/content.ts` | TypeAliasDeclaration | `CanonicalVideo` |
| `src/domain/content.ts` | VariableStatement | `canonicalVideoSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `ChannelPersonMappings` |
| `src/domain/content.ts` | VariableStatement | `channelPersonMappingsSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `CollaborationProfiles` |
| `src/domain/content.ts` | VariableStatement | `collaborationProfilesSchema` |
| `src/domain/content.ts` | VariableStatement | `confidenceSchema` |
| `src/domain/content.ts` | VariableStatement | `customEmojiUsageSchema` |
| `src/domain/content.ts` | VariableStatement | `entityRelationTypeSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `EntityType` |
| `src/domain/content.ts` | VariableStatement | `entityTypeSchema` |
| `src/domain/content.ts` | VariableStatement | `evidenceReferenceSchema` |
| `src/domain/content.ts` | VariableStatement | `evidenceTypeSchema` |
| `src/domain/content.ts` | FunctionDeclaration | `findTagId` |
| `src/domain/content.ts` | TypeAliasDeclaration | `GameCatalog` |
| `src/domain/content.ts` | VariableStatement | `gameCatalogSchema` |
| `src/domain/content.ts` | VariableStatement | `independentReviewSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `LatestRelease` |
| `src/domain/content.ts` | VariableStatement | `latestReleaseSchema` |
| `src/domain/content.ts` | VariableStatement | `legacyIndependentReviewSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicAliasIndex` |
| `src/domain/content.ts` | VariableStatement | `publicAliasIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicEntityIndex` |
| `src/domain/content.ts` | VariableStatement | `publicEntityIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicGameIndex` |
| `src/domain/content.ts` | VariableStatement | `publicGameIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicIndex` |
| `src/domain/content.ts` | VariableStatement | `publicIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicSongIndex` |
| `src/domain/content.ts` | VariableStatement | `publicSongIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicTagIndex` |
| `src/domain/content.ts` | VariableStatement | `publicTagIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicVideoDetail` |
| `src/domain/content.ts` | VariableStatement | `publicVideoDetailSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicVideoShard` |
| `src/domain/content.ts` | VariableStatement | `publicVideoShardSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `PublicVideoSummary` |
| `src/domain/content.ts` | VariableStatement | `publicVideoSummarySchema` |
| `src/domain/content.ts` | VariableStatement | `pullRequestMergeIndependentReviewSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `SearchIndex` |
| `src/domain/content.ts` | VariableStatement | `searchIndexSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `SongPerformanceCatalog` |
| `src/domain/content.ts` | VariableStatement | `songPerformanceCatalogSchema` |
| `src/domain/content.ts` | VariableStatement | `songPerformanceTypeSchema` |
| `src/domain/content.ts` | VariableStatement | `synopsisSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `TagAliases` |
| `src/domain/content.ts` | VariableStatement | `tagAliasesSchema` |
| `src/domain/content.ts` | VariableStatement | `tagAssignmentSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `TagTaxonomy` |
| `src/domain/content.ts` | VariableStatement | `tagTaxonomySchema` |
| `src/domain/content.ts` | InterfaceDeclaration | `TaxonomyLookupItem` |
| `src/domain/content.ts` | VariableStatement | `taxonomyValueKindSchema` |
| `src/domain/content.ts` | VariableStatement | `timestampItemSchema` |
| `src/domain/content.ts` | VariableStatement | `timestampMissingReasonSchema` |
| `src/domain/content.ts` | VariableStatement | `timestampOriginSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `VideoEntityRole` |
| `src/domain/content.ts` | VariableStatement | `videoEntityRoleSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `VideoExclusions` |
| `src/domain/content.ts` | VariableStatement | `videoExclusionsSchema` |
| `src/domain/content.ts` | FunctionDeclaration | `videoShardId` |
| `src/domain/content.ts` | TypeAliasDeclaration | `WordCloudInputType` |
| `src/domain/content.ts` | VariableStatement | `wordCloudInputTypeSchema` |
| `src/domain/content.ts` | VariableStatement | `wordCloudMissingReasonSchema` |
| `src/domain/content.ts` | TypeAliasDeclaration | `WorkIntroductions` |
| `src/domain/content.ts` | VariableStatement | `workIntroductionsSchema` |
| `src/domain/entities.ts` | FunctionDeclaration | `buildEntityProjection` |
| `src/domain/entities.ts` | InterfaceDeclaration | `BuildEntityProjectionInput` |
| `src/domain/entities.ts` | InterfaceDeclaration | `EntityProjection` |
| `src/domain/game-catalog.ts` | FunctionDeclaration | `applyGameCatalogGenres` |
| `src/domain/game-catalog.ts` | FunctionDeclaration | `catalogGameGenreTagIds` |
| `src/domain/game-title-detection.ts` | FunctionDeclaration | `detectExplicitGameTitleTagIds` |
| `src/domain/parallel-game-perspectives.ts` | FunctionDeclaration | `findParallelGamePerspectives` |
| `src/domain/parallel-game-perspectives.ts` | VariableStatement | `minimumParallelPerspectiveOverlapSeconds` |
| `src/domain/parallel-game-perspectives.ts` | InterfaceDeclaration | `ParallelGamePerspective` |
| `src/domain/search.ts` | FunctionDeclaration | `additionalTagCounts` |
| `src/domain/search.ts` | FunctionDeclaration | `applySearch` |
| `src/domain/search.ts` | FunctionDeclaration | `bucketRange` |
| `src/domain/search.ts` | FunctionDeclaration | `buildSearchSuggestions` |
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
| `src/domain/search.ts` | InterfaceDeclaration | `SearchSuggestions` |
| `src/domain/search.ts` | TypeAliasDeclaration | `SearchVideo` |
| `src/domain/search.ts` | FunctionDeclaration | `serializeCondition` |
| `src/domain/search.ts` | TypeAliasDeclaration | `SortOrder` |
| `src/domain/search.ts` | InterfaceDeclaration | `SuggestionTag` |
| `src/domain/search.ts` | InterfaceDeclaration | `SuggestionVideo` |
| `src/domain/search.ts` | FunctionDeclaration | `tagCountsForResults` |
| `src/domain/search.ts` | FunctionDeclaration | `tokenizeQuery` |
| `src/domain/search.ts` | FunctionDeclaration | `validateCondition` |
| `src/domain/tag-assignment-audit.ts` | FunctionDeclaration | `auditTagAssignmentCoverage` |
| `src/domain/tag-assignment-audit.ts` | InterfaceDeclaration | `TagAssignmentAuditResult` |
| `src/domain/tag-assignment-audit.ts` | InterfaceDeclaration | `TagAssignmentAuditRow` |
| `src/domain/tag-assignment-audit.ts` | TypeAliasDeclaration | `TagAssignmentAuditSource` |
| `src/domain/tag-assignment-audit.ts` | VariableStatement | `tagAssignmentAuditSourceSchema` |
| `src/domain/validation.ts` | FunctionDeclaration | `scanPublicBoundary` |
| `src/domain/validation.ts` | FunctionDeclaration | `validateCanonicalVideo` |
| `src/domain/validation.ts` | FunctionDeclaration | `validateChannelPersonMappings` |
| `src/domain/validation.ts` | FunctionDeclaration | `validateGameCatalog` |
| `src/domain/validation.ts` | FunctionDeclaration | `validateSongPerformanceCatalog` |
| `src/domain/validation.ts` | FunctionDeclaration | `validateTaxonomy` |
| `src/domain/validation.ts` | InterfaceDeclaration | `ValidationIssue` |
| `src/features/collaborations/CollaboratorDetailPage.tsx` | FunctionDeclaration | `CollaboratorDetailPage` |
| `src/features/collaborations/GroupDetailPage.tsx` | FunctionDeclaration | `GroupDetailPage` |
| `src/features/detail/VideoDetailPage.tsx` | FunctionDeclaration | `VideoDetailPage` |
| `src/features/detail/WordCloud.tsx` | FunctionDeclaration | `WordCloud` |
| `src/features/detail/WordCloud.tsx` | FunctionDeclaration | `wordCloudEyebrow` |
| `src/features/detail/wordCloudLayout.ts` | FunctionDeclaration | `buildWordCloudLayout` |
| `src/features/detail/wordCloudLayout.ts` | InterfaceDeclaration | `PositionedWord` |
| `src/features/detail/wordCloudLayout.ts` | InterfaceDeclaration | `WordCloudInputWord` |
| `src/features/detail/wordCloudLayout.ts` | TypeAliasDeclaration | `WordCloudLayoutMode` |
| `src/features/detail/wordCloudLayout.ts` | VariableStatement | `wordCloudViewBoxes` |
| `src/features/entities/EntityIndexPage.tsx` | FunctionDeclaration | `EntityIndexPage` |
| `src/features/games/gameGenreIcons.ts` | VariableStatement | `GAME_GENRE_ICONS` |
| `src/features/games/gameGenreIcons.ts` | FunctionDeclaration | `gameGenreIcon` |
| `src/features/games/GameIndexPage.tsx` | FunctionDeclaration | `GameIndexPage` |
| `src/features/library/DeviceLibraryPage.tsx` | FunctionDeclaration | `DeviceLibraryPage` |
| `src/features/search/DateRangePicker.tsx` | FunctionDeclaration | `DateRangePicker` |
| `src/features/search/DurationRangeSlider.tsx` | FunctionDeclaration | `DurationRangeSlider` |
| `src/features/search/SearchPage.tsx` | FunctionDeclaration | `SearchPage` |
| `src/features/series/SeriesDetailPage.tsx` | FunctionDeclaration | `SeriesDetailPage` |
| `src/features/songs/SongIndexPage.tsx` | FunctionDeclaration | `SongIndexPage` |
| `src/features/works/WorkDetailPage.tsx` | FunctionDeclaration | `WorkDetailPage` |
| `src/format.ts` | FunctionDeclaration | `formatDate` |
| `src/format.ts` | FunctionDeclaration | `formatDuration` |
| `src/format.ts` | FunctionDeclaration | `formatTimestamp` |

## 自動試験

- `e2e/detail.spec.ts`
- `e2e/game-index.spec.ts`
- `e2e/library.spec.ts`
- `e2e/search.spec.ts`
- `e2e/song-index.spec.ts`
- `src/data/deviceStore.test.ts`
- `src/data/loadPublicData.test.ts`
- `src/domain/collaboration-group-audit.test.ts`
- `src/domain/collaboration.test.ts`
- `src/domain/game-title-detection.test.ts`
- `src/domain/search.test.ts`
- `src/domain/tag-assignment-audit.test.ts`
- `src/domain/validation.test.ts`
- `src/features/collaborations/CollaborationDetailPages.test.tsx`
- `src/features/detail/wordCloudLayout.test.ts`
- `src/features/entities/EntityIndexPage.test.tsx`
- `src/features/games/GameIndexPage.test.tsx`
- `src/features/search/SearchFilterControls.test.tsx`
- `src/features/search/SearchPage.test.tsx`
- `src/features/series/SeriesDetailPage.test.tsx`
- `src/features/songs/SongIndexPage.test.tsx`
- `src/features/works/WorkDetailPage.test.tsx`

## 入力指紋

machine-readableな完全一覧は `inventory.gen.json` に保存します。入力84ファイル、公開契約201件です。
