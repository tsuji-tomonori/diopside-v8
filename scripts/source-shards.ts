import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalJson, prettyJson, readJson, sha256 } from './lib.ts';

export interface SourceShardEntry {
  shardId: string;
  path: string;
  itemCount: number;
  fingerprint: string;
}

export interface SourceShardManifest {
  schemaVersion: '1.0.0';
  source: Record<string, unknown>;
  snapshotFingerprint: string;
  itemField: string;
  itemCount: number;
  shardCount: number;
  shardAlgorithm: string;
  shards: SourceShardEntry[];
}

export function readSourceShards<T>(
  repositoryRoot: string,
  manifestRelativePath: string,
  expectedField: string,
): { manifest: SourceShardManifest; items: T[] } {
  const manifestPath = path.join(repositoryRoot, manifestRelativePath);
  const manifest = readJson(manifestPath) as SourceShardManifest;
  if (manifest.schemaVersion !== '1.0.0' || manifest.itemField !== expectedField) {
    throw new Error(`${manifestRelativePath}: シャードマニフェストの形式が不正です。`);
  }
  if (manifest.shards.length !== manifest.shardCount) {
    throw new Error(`${manifestRelativePath}: 宣言したシャード数と実件数が一致しません。`);
  }
  const items: T[] = [];
  for (const shard of manifest.shards) {
    const shardPath = path.resolve(repositoryRoot, shard.path);
    if (!shardPath.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`) || !existsSync(shardPath)) {
      throw new Error(`${manifestRelativePath}: シャード参照を解決できません: ${shard.path}`);
    }
    const contents = readFileSync(shardPath, 'utf8');
    if (sha256(contents) !== shard.fingerprint) {
      throw new Error(`${manifestRelativePath}: シャード指紋が一致しません: ${shard.path}`);
    }
    const value = JSON.parse(contents) as Record<string, unknown>;
    const shardItems = value[expectedField];
    if (!Array.isArray(shardItems) || shardItems.length !== shard.itemCount) {
      throw new Error(`${manifestRelativePath}: シャード件数が一致しません: ${shard.path}`);
    }
    items.push(...shardItems as T[]);
  }
  if (items.length !== manifest.itemCount) {
    throw new Error(`${manifestRelativePath}: 総件数が一致しません。`);
  }
  return { manifest, items };
}

export function shardIdForKey(key: string, shardCount: number): string {
  if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 256) {
    throw new Error(`シャード数が不正です: ${shardCount}`);
  }
  const digest = createHash('sha256').update(key, 'utf8').digest();
  const value = digest.readUInt32BE(0) % shardCount;
  return value.toString(16).padStart(Math.max(2, (shardCount - 1).toString(16).length), '0');
}

export function writeSourceShards<T>(options: {
  repositoryRoot: string;
  directory: string;
  itemField: string;
  items: T[];
  key: (item: T) => string;
  shardCount: number;
  source: Record<string, unknown>;
}): SourceShardManifest {
  const relativeDirectory = options.directory.split(path.sep).join('/').replace(/^\/+|\/+$/gu, '');
  const targetDirectory = path.join(options.repositoryRoot, relativeDirectory);
  const repositoryRoot = path.resolve(options.repositoryRoot);
  if (!path.resolve(targetDirectory).startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error(`出力先がリポジトリ外です: ${options.directory}`);
  }
  const ordered = [...options.items].sort((left, right) => options.key(left).localeCompare(options.key(right)));
  const buckets = new Map<string, T[]>();
  for (let index = 0; index < options.shardCount; index += 1) {
    const shardId = index.toString(16).padStart(Math.max(2, (options.shardCount - 1).toString(16).length), '0');
    buckets.set(shardId, []);
  }
  for (const item of ordered) buckets.get(shardIdForKey(options.key(item), options.shardCount))!.push(item);

  rmSync(targetDirectory, { recursive: true, force: true });
  mkdirSync(targetDirectory, { recursive: true });
  const shards: SourceShardEntry[] = [];
  for (const [shardId, values] of buckets) {
    const relativePath = `${relativeDirectory}/${shardId}.json`;
    const contents = prettyJson({
      schemaVersion: '1.0.0',
      shardId,
      itemCount: values.length,
      [options.itemField]: values,
    });
    writeFileSync(path.join(options.repositoryRoot, relativePath), contents);
    shards.push({ shardId, path: relativePath, itemCount: values.length, fingerprint: sha256(contents) });
  }
  const manifest: SourceShardManifest = {
    schemaVersion: '1.0.0',
    source: options.source,
    snapshotFingerprint: sha256(canonicalJson(ordered)),
    itemField: options.itemField,
    itemCount: ordered.length,
    shardCount: options.shardCount,
    shardAlgorithm: 'sha256(key) modulo shardCount',
    shards,
  };
  writeFileSync(path.join(targetDirectory, 'manifest.json'), prettyJson(manifest));
  return manifest;
}
