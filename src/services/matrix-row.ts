import type { MatrixRow, MatrixRowData, MatrixVersion, MatrixVersionData } from "../types";
import type { HalBuilder } from "./hal";

/**
 * Decorate a durable-object matrix row with HAL links, producing the wire
 * shape described by the reference broker's matrix_decorator.rb.
 *
 * Links are added here rather than in the durable object because only the
 * request knows the broker's public host.
 */
function decorateVersion(
  hal: HalBuilder,
  pacticipant: string,
  version: MatrixVersionData,
): MatrixVersion {
  return {
    number: version.number,
    branch: version.branch,
    tags: version.tags.map((name) => ({ name })),
    _links: {
      self: hal.link(
        `/pacticipants/${encodeURIComponent(pacticipant)}/versions/${encodeURIComponent(version.number)}`,
      ),
    },
  };
}

export function decorateMatrixRow(hal: HalBuilder, row: MatrixRowData): MatrixRow {
  return {
    consumer: {
      name: row.consumer.name,
      version: decorateVersion(hal, row.consumer.name, row.consumer.version),
      _links: { self: hal.link(`/pacticipants/${encodeURIComponent(row.consumer.name)}`) },
    },
    provider: {
      name: row.provider.name,
      version: row.provider.version
        ? decorateVersion(hal, row.provider.name, row.provider.version)
        : null,
      _links: { self: hal.link(`/pacticipants/${encodeURIComponent(row.provider.name)}`) },
    },
    pact: {
      createdAt: row.pact.createdAt,
      _links: {
        self: hal.pact(
          row.provider.name,
          row.consumer.name,
          row.consumer.version.number,
          row.pact.sha,
        ).self,
      },
    },
    verificationResult: row.verification
      ? {
          success: row.verification.success,
          verifiedAt: row.verification.verifiedAt,
          _links: {
            self: hal.verification(
              row.provider.name,
              row.consumer.name,
              row.pact.sha,
              row.verification.id,
            ).self,
          },
        }
      : null,
  };
}
