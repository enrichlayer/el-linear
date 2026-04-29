import type { LinearService } from "./linear-service.js";

/**
 * Resolve each candidate identifier to its UUID. Returns a map containing only
 * identifiers that resolved successfully — non-existent IDs (e.g. "ISO-1424"
 * false positives, or refs to issues outside the workspace) are dropped silently.
 *
 * Resolutions run in parallel for throughput. The map preserves the order of
 * the input array via insertion order on the underlying Map.
 */
export async function validateReferences(
  identifiers: readonly string[],
  linearService: LinearService,
): Promise<Map<string, string>> {
  const valid = new Map<string, string>();
  if (identifiers.length === 0) {
    return valid;
  }

  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const unique = identifiers.filter((id) => {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });

  const settled = await Promise.allSettled(
    unique.map(async (id) => ({ id, uuid: await linearService.resolveIssueId(id) })),
  );
  for (const result of settled) {
    if (result.status === "fulfilled") {
      valid.set(result.value.id, result.value.uuid);
    }
  }
  return valid;
}
