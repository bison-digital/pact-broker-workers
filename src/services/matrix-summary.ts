/**
 * Matrix / can-i-deploy summary, shaped after the reference Pact Broker.
 *
 * Wording is taken from the reference implementation so that clients reading
 * `summary.reason` see the same sentences they would from a Ruby broker:
 *   - reasons              lib/pact_broker/api/decorators/reason_decorator.rb
 *   - selector descriptions lib/pact_broker/matrix/resolved_selector.rb
 *
 * The reference joins every applicable reason with "\n" (matrix_decorator.rb);
 * it never reports one and drops the others.
 */

/** One integration, flattened to what a summary needs to describe it. */
export interface SummaryRow {
  consumer: { name: string; version: string | null };
  provider: { name: string; version: string | null };
  /** `null` means "no verification result", i.e. unknown — not "failed". */
  success: boolean | null;
}

export interface MatrixSummary {
  /**
   * Tri-state, per deployment_status_summary.rb#deployable?: `false` only when
   * something is known bad, `null` while anything is unknown, `true` otherwise.
   * "Not verified yet" and "verified and failed" are different facts.
   */
  deployable: boolean | null;
  reason: string;
  /** Key names mirror deployment_status_summary.rb#counts. */
  success: number;
  failed: number;
  unknown: number;
}

/** `version 1.0.0 of foo` / `any version of foo` — resolved_selector.rb#description */
function describeSelector(selector: { name: string; version: string | null }): string {
  if (selector.version) {
    return `version ${selector.version} of ${selector.name}`;
  }
  return `any version of ${selector.name}`;
}

/**
 * Flatten matrix rows into what the summary needs. Typed structurally rather
 * than against MatrixRow so this module stays free of an import cycle with
 * `types/index.ts`.
 */
export function toSummaryRows(
  rows: Array<{
    consumer: { name: string; version: { number: string } };
    provider: { name: string; version: { number: string } | null };
    verification?: { success: boolean } | null;
  }>,
): SummaryRow[] {
  return rows.map((row) => ({
    consumer: { name: row.consumer.name, version: row.consumer.version.number },
    provider: { name: row.provider.name, version: row.provider.version?.number ?? null },
    success: row.verification ? row.verification.success : null,
  }));
}

/** matrix_decorator.rb#notices — reason.type is `error` for ErrorReason, else `info`. */
export interface MatrixNotice {
  type: "error" | "info";
  text: string;
}

export function summarizeMatrix(rows: SummaryRow[]): {
  summary: MatrixSummary;
  notices: MatrixNotice[];
} {
  const reasons: MatrixNotice[] = [];
  const counts = {
    success: rows.filter((r) => r.success === true).length,
    failed: rows.filter((r) => r.success === false).length,
    unknown: rows.filter((r) => r.success === null).length,
  };

  for (const row of rows.filter((r) => r.success === false)) {
    reasons.push({
      type: "error",
      text:
        `The verification for the pact between ${describeSelector(row.consumer)} and ` +
        `any version of ${row.provider.name} failed`,
    });
  }

  for (const row of rows.filter((r) => r.success === null)) {
    reasons.push({
      type: "error",
      text:
        `There is no verified pact between ${describeSelector(row.consumer)} and ` +
        `any version of ${row.provider.name}`,
    });
  }

  if (reasons.length === 0) {
    reasons.push({
      type: "info",
      text:
        rows.length === 0
          ? "There are no missing dependencies"
          : "All required verification results are published and successful",
    });
  }

  const deployable = counts.failed > 0 ? false : counts.unknown > 0 ? null : true;

  return {
    summary: { deployable, reason: reasons.map((r) => r.text).join("\n"), ...counts },
    notices: reasons,
  };
}
