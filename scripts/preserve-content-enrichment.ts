import type { CanonicalVideo } from '../src/domain/content.ts';
import { auditContentPreservation } from './content-preservation.ts';
import { canonicalJson, sha256 } from './lib.ts';

/** Draft projection only. Never copies approval, provenance, tags or existing content. */
export function preserveContentEnrichment(current: CanonicalVideo, source: CanonicalVideo) {
  if (current.videoId !== source.videoId) throw new Error('動画IDが一致しません。');
  const proposed = structuredClone(current);
  const requested: Array<'synopsis' | 'timestamps'> = [];
  if (!current.synopsis && source.synopsis) requested.push('synopsis');
  if (current.timestamps.status === '未作成'
    && !['対象外', '短尺'].includes(current.timestamps.reason)
    && source.timestamps.status === '作成済み') requested.push('timestamps');
  const blockers: string[] = [];
  const additions: typeof requested = [];
  if (requested.length > 0 && (current.durationSeconds === null || current.durationSeconds !== source.durationSeconds)) {
    blockers.push('DURATION_CHANGED');
  }
  const needed = new Set<string>();
  for (const feature of requested) {
    if (feature === 'synopsis') {
      const synopsis = source.synopsis!;
      for (const ref of [...synopsis.bodyEvidenceRefs, ...synopsis.featuredQuote.evidenceRefs]) needed.add(ref);
      for (const evidence of source.evidence.filter((item) => item.inputFingerprint === synopsis.inputFingerprint)) needed.add(evidence.evidenceId);
    } else if (source.timestamps.status === '作成済み') {
      const timestamps = source.timestamps;
      for (const item of timestamps.items) for (const ref of item.evidenceRefs) needed.add(ref);
      for (const evidence of source.evidence.filter((item) => item.inputFingerprint === timestamps.inputFingerprint)) needed.add(evidence.evidenceId);
    }
  }
  const oldEvidence = new Map(current.evidence.map((item) => [item.evidenceId, item]));
  const sourceEvidence = new Map(source.evidence.map((item) => [item.evidenceId, item]));
  if (oldEvidence.size !== current.evidence.length || sourceEvidence.size !== source.evidence.length) blockers.push('DUPLICATE_EVIDENCE_ID');
  for (const id of [...needed].sort()) {
    const old = oldEvidence.get(id);
    const next = sourceEvidence.get(id);
    if (!next) blockers.push(`EVIDENCE_MISSING:${id}`);
    else if (old && canonicalJson(old) !== canonicalJson(next)) blockers.push(`EVIDENCE_CONFLICT:${id}`);
  }
  // Fail the whole video's projection closed; never partly adopt conflicting evidence.
  if (blockers.length === 0 && requested.length > 0) {
    if (requested.includes('synopsis')) proposed.synopsis = structuredClone(source.synopsis!);
    if (requested.includes('timestamps')) proposed.timestamps = structuredClone(source.timestamps);
    for (const id of [...needed].sort()) {
      if (!oldEvidence.has(id)) proposed.evidence.push(structuredClone(sourceEvidence.get(id)!));
    }
    additions.push(...requested);
  }
  const fingerprint = (video: CanonicalVideo) => sha256(canonicalJson(video));
  const audit = auditContentPreservation([current], [proposed]);
  if (audit.counts.regressionVideos !== 0) throw new Error('既存機能を保持できません。');
  return {
    proposed,
    summary: {
      videoId: current.videoId,
      publicationAllowed: false as const,
      currentFingerprint: fingerprint(current),
      sourceFingerprint: fingerprint(source),
      proposedFingerprint: fingerprint(proposed),
      requested,
      additions,
      blockers,
      // Keeping these hashes is historical evidence, not a new review or approval.
      sourceTimestampCandidateHash: source.timestamps.status === '作成済み' ? source.timestamps.candidateHash : null,
      sourceSynopsisFingerprint: source.synopsis ? sha256(canonicalJson(source.synopsis)) : null,
      changedFields: audit.records[0]!.changedFields,
    },
  };
}
