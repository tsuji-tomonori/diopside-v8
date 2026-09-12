import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  canonicalVideoSchema,
  videoExclusionsSchema,
  type CanonicalVideo,
} from '../src/domain/content.ts';
import { readJson } from './lib.ts';
import { readSourceShards } from './source-shards.ts';

export interface CanonicalStoreOptions {
  includeExcluded?: boolean;
}

export function readCanonicalVideos(
  repositoryRoot: string,
  options: CanonicalStoreOptions = {},
): CanonicalVideo[] {
  const exclusionsPath = path.join(repositoryRoot, 'content/exclusions.json');
  const excludedVideoIds = !options.includeExcluded && existsSync(exclusionsPath)
    ? new Set(videoExclusionsSchema.parse(readJson(exclusionsPath)).records.map((record) => record.videoId))
    : new Set<string>();
  const catalogPath = 'content/catalog/manifest.json';
  const catalog = existsSync(path.join(repositoryRoot, catalogPath))
    ? readSourceShards<unknown>(repositoryRoot, catalogPath, 'videos').items.map((video) => canonicalVideoSchema.parse(video))
    : [];
  const videos = new Map<string, CanonicalVideo>();
  for (const video of catalog) {
    if (videos.has(video.videoId)) throw new Error(`移行カタログの動画IDが重複しています: ${video.videoId}`);
    videos.set(video.videoId, video);
  }
  const overrideDirectory = path.join(repositoryRoot, 'content/videos');
  if (existsSync(overrideDirectory)) {
    for (const file of readdirSync(overrideDirectory).filter((name) => name.endsWith('.json')).sort()) {
      const video = canonicalVideoSchema.parse(readJson(path.join(overrideDirectory, file)));
      if (path.basename(file, '.json') !== video.videoId) {
        throw new Error(`${file}: ファイル名と動画IDが一致しません。`);
      }
      videos.set(video.videoId, video);
    }
  }
  return [...videos.values()]
    .filter((video) => !excludedVideoIds.has(video.videoId))
    .sort((left, right) => left.videoId.localeCompare(right.videoId));
}
