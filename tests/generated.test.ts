import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  latestReleaseSchema,
  collaborationProfilesSchema,
  publicAliasIndexSchema,
  publicIndexSchema,
  publicTagIndexSchema,
  publicVideoShardSchema,
  searchIndexSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  workIntroductionsSchema,
  type CanonicalVideo,
} from '../src/domain/content.ts';
import { scanPublicBoundary } from '../src/domain/validation.ts';
import { embeddedReleaseId } from '../src/generated/release.ts';
import { canonicalJson, sha256 } from '../scripts/lib.ts';
import { readCanonicalVideos } from '../scripts/canonical-store.ts';

const root = process.cwd();

describe('決定的な公開成果物', () => {
  const latest = latestReleaseSchema.parse(json('public/data/latest.json'));
  const releaseRoot = path.join(root, 'public/data/releases', latest.releaseId);
  const contentManifest = json('content/content-manifest.json') as {
    videoCount: number;
    createdTimestampVideoCount: number;
    timestampItemCount: number;
  };

  it('正本の論理内容から同じ公開版IDを再計算できる', () => {
    const taxonomy = tagTaxonomySchema.parse(json('content/taxonomy/tag-taxonomy.json'));
    const aliases = tagAliasesSchema.parse(json('content/taxonomy/tag-aliases.json'));
    const workIntroductions = workIntroductionsSchema.parse(json('content/works/work-introductions.json'));
    const collaborationProfiles = collaborationProfilesSchema.parse(json('content/people/collaboration-profiles.json'));
    const videos = readCanonicalVideos(root).map(normalizeCanonicalVideo);
    const expected = `release-${sha256(canonicalJson({ taxonomy, aliases, workIntroductions, collaborationProfiles, videos })).slice(0, 16)}`;
    expect(latest.releaseId).toBe(expected);
    expect(embeddedReleaseId).toBe(expected);
  });

  it('索引・詳細・画面埋込版がすべて同じ公開版を参照する', () => {
    const index = publicIndexSchema.parse(json(`public/${latest.indexPath}`));
    const search = searchIndexSchema.parse(json(`public/${latest.searchIndexPath}`));
    const tags = publicTagIndexSchema.parse(json(`public/${latest.tagIndexPath}`));
    const aliases = publicAliasIndexSchema.parse(json(`public/${latest.aliasIndexPath}`));
    expect(new Set([latest.releaseId, index.releaseId, search.releaseId, tags.releaseId, aliases.releaseId, embeddedReleaseId]).size).toBe(1);
    expect(index.videos.map((video) => video.videoId)).toEqual(search.videos.map((video) => video.videoId));
    expect(index.videos).toHaveLength(contentManifest.videoCount);
  });

  it('公開詳細シャードは全動画を持ち、作成済み件数が正本manifestと一致する', () => {
    const details = Array.from({ length: latest.videoShardCount }, (_, index) => {
      const shardId = index.toString(16).padStart(2, '0');
      return publicVideoShardSchema.parse(json(`public/data/releases/${latest.releaseId}/video-shards/${shardId}.json`));
    }).flatMap((shard) => Object.values(shard.videos));
    expect(details).toHaveLength(contentManifest.videoCount);
    expect(details.filter((detail) => detail.timestamps.status === '作成済み')).toHaveLength(contentManifest.createdTimestampVideoCount);
    expect(details.reduce((total, detail) => total + (detail.timestamps.status === '作成済み' ? detail.timestamps.items.length : 0), 0)).toBe(contentManifest.timestampItemCount);
  });

  it('版マニフェストの全ファイル指紋が実ファイルと一致する', () => {
    const manifest = json(`public/${latest.manifestPath}`) as {
      releaseId: string;
      files: Array<{ path: string; sha256: string }>;
    };
    expect(manifest.releaseId).toBe(latest.releaseId);
    const profiles = collaborationProfilesSchema.parse(json('content/people/collaboration-profiles.json'));
    const uniqueIconFiles = new Set(profiles.people.map((person) => person.iconFile));
    expect(manifest.files).toHaveLength(260 + uniqueIconFiles.size);
    expect(new Set(manifest.files.map((file) => file.path)).size).toBe(manifest.files.length);
    for (const file of manifest.files) {
      expect(sha256(readFileSync(path.join(releaseRoot, file.path)))).toBe(file.sha256);
    }
  });

  it('Pages用docsは同じ版を持ち、404でもSPAへ到達できる', () => {
    const docsLatest = latestReleaseSchema.parse(json('docs/data/latest.json'));
    expect(docsLatest.releaseId).toBe(latest.releaseId);
    expect(readFileSync(path.join(root, 'docs/index.html'), 'utf8')).toContain('/assets/');
    expect(readFileSync(path.join(root, 'docs/404.html'), 'utf8')).toContain('/assets/');
    expect(readFileSync(path.join(root, 'docs/index.html'), 'utf8')).not.toContain('/diopside-v8/');
    expect(readFileSync(path.join(root, 'docs/404.html'), 'utf8')).not.toContain('/diopside-v8/');
    expect(readFileSync(path.join(root, 'docs/.nojekyll'), 'utf8')).toBe('');
  });

  it('生成公開物を再帰走査して公開禁止情報がないことを確認する', () => {
    for (const file of walkJson(path.join(root, 'public/data'))) {
      expect(scanPublicBoundary(JSON.parse(readFileSync(file, 'utf8'))), path.relative(root, file)).toEqual([]);
    }
  });
});

function normalizeCanonicalVideo(video: CanonicalVideo): CanonicalVideo {
  return {
    ...video,
    evidence: [...video.evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    tagAssignments: [...video.tagAssignments].sort((left, right) => left.tagId.localeCompare(right.tagId)),
  };
}

function walkJson(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkJson(target) : entry.name.endsWith('.json') ? [target] : [];
  });
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
