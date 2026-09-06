export interface CollaborationCandidate {
  name: string;
  isSubject: boolean;
  isHost: boolean;
  isFixedRadioPartner: boolean;
}

export type CollaborationSelectionPolicy = 'all-partners' | 'call-in-host-only' | 'sequential-guest-host-only' | 'regular-radio-fixed-partners-only';

export function selectCollaboratorNames(
  candidates: CollaborationCandidate[],
  policy: CollaborationSelectionPolicy,
): string[] {
  return [...new Set(candidates
    .filter((candidate) => !candidate.isSubject)
    .filter((candidate) => {
      if (policy === 'call-in-host-only' || policy === 'sequential-guest-host-only') return candidate.isHost;
      if (policy === 'regular-radio-fixed-partners-only') return candidate.isFixedRadioPartner;
      return true;
    })
    .map((candidate) => candidate.name))]
    .sort((left, right) => left.localeCompare(right, 'ja'));
}
