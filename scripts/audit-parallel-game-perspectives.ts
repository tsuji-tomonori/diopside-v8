import path from 'node:path';

import {
  channelPersonMappingsSchema,
  collaborationProfilesSchema,
  gameCatalogSchema,
  tagTaxonomySchema,
  videoExclusionsSchema,
} from '../src/domain/content.ts';
import { findParallelGamePerspectives } from '../src/domain/parallel-game-perspectives.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { canonicalJson, readJson, sha256 } from './lib.ts';

const root = path.resolve(import.meta.dirname, '..');
const videos = readCanonicalVideos(root);
const videosIncludingExcluded = readCanonicalVideos(root, { includeExcluded: true });
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const channelPersonMappings = channelPersonMappingsSchema.parse(readJson(path.join(root, 'content/people/channel-person-mappings.json')));
const collaborationProfiles = collaborationProfilesSchema.parse(readJson(path.join(root, 'content/people/collaboration-profiles.json')));
const gameCatalog = gameCatalogSchema.parse(readJson(path.join(root, 'content/works/game-catalog.json')));
const exclusions = videoExclusionsSchema.parse(readJson(path.join(root, 'content/exclusions.json')));
const publicFindings = findParallelGamePerspectives(
  videos,
  taxonomy,
  channelPersonMappings,
  collaborationProfiles.subjectPersonTagId,
  gameCatalog,
);
const allFindings = findParallelGamePerspectives(
  videosIncludingExcluded,
  taxonomy,
  channelPersonMappings,
  collaborationProfiles.subjectPersonTagId,
  gameCatalog,
);
const findingByVideoId = new Map(allFindings.map((finding) => [finding.videoId, finding]));
const exclusionByVideoId = new Map(exclusions.records.map((record) => [record.videoId, record]));
const errors = publicFindings.map((finding) => (
  `${finding.videoId}: 公開正本に重複視点が残っています（白雪巴公式枠 ${finding.preferredVideoId}）`
));
for (const finding of allFindings) {
  const record = exclusionByVideoId.get(finding.videoId);
  if (record?.ruleId !== 'V8-SAFETY-005') {
    errors.push(`${finding.videoId}: V8-SAFETY-005の除外記録がありません。`);
  } else if (record.preferredVideoId !== finding.preferredVideoId) {
    errors.push(`${finding.videoId}: 優先する白雪巴公式枠が一致しません。`);
  } else if (record.sourceFingerprint !== sha256(canonicalJson(finding))) {
    errors.push(`${finding.videoId}: 判定入力指紋が一致しません。`);
  }
}
for (const record of exclusions.records.filter((item) => item.ruleId === 'V8-SAFETY-005')) {
  if (!findingByVideoId.has(record.videoId)) {
    errors.push(`${record.videoId}: 除外記録の元になった重複視点を再現できません。`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`参加者別の同時ゲーム配信 ${allFindings.length}件はすべて除外台帳と一致し、公開正本には含まれていません。`);
}
