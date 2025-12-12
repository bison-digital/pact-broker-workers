import type { PactBrokerDO } from "../durable-objects/pact-broker";

// Cloudflare bindings
export interface Env {
  PACT_BROKER: DurableObjectNamespace<PactBrokerDO>;
  PACT_BROKER_TOKEN: string;
  ALLOW_PUBLIC_READ: string;
}

// HAL link structure
export interface HalLink {
  href: string;
  title?: string;
  templated?: boolean;
}

export interface HalLinks {
  self: HalLink;
  [key: string]: HalLink | HalLink[] | undefined;
}

// API response types with HAL
export interface HalResource {
  _links: HalLinks;
}

// Pact content structure (simplified)
export interface PactContent {
  consumer: { name: string };
  provider: { name: string };
  interactions: unknown[];
  metadata?: {
    pactSpecification?: { version: string };
    [key: string]: unknown;
  };
}

// API request/response types
export interface PublishPactRequest {
  consumer: { name: string };
  provider: { name: string };
  interactions: unknown[];
  metadata?: Record<string, unknown>;
}

export interface PactResponse extends HalResource {
  consumer: { name: string };
  provider: { name: string };
  consumerVersion: string;
  contentSha: string;
  createdAt: string;
  interactions: unknown[];
  metadata?: Record<string, unknown>;
}

export interface VerificationResultRequest {
  success: boolean;
  providerApplicationVersion: string;
  buildUrl?: string;
}

export interface VerificationResultResponse extends HalResource {
  success: boolean;
  providerApplicationVersion: string;
  buildUrl?: string | null;
  verifiedAt: string;
}

export interface MatrixRow {
  consumer: { name: string; version: string };
  provider: { name: string; version: string | null };
  pactVersion: { sha: string };
  verificationResult?: {
    success: boolean;
    verifiedAt: string;
  } | null;
}

export interface MatrixResponse extends HalResource {
  summary: {
    deployable: boolean;
    reason: string;
  };
  matrix: MatrixRow[];
}

export interface CanIDeployResponse extends HalResource {
  summary: {
    deployable: boolean;
    reason: string;
  };
  matrix: MatrixRow[];
}

export interface PacticipantResponse extends HalResource {
  name: string;
  createdAt: string;
}

export interface VersionResponse extends HalResource {
  number: string;
  branch?: string | null;
  buildUrl?: string | null;
  createdAt: string;
}

export interface TagResponse extends HalResource {
  name: string;
  createdAt: string;
}

// Index/root response
export interface IndexResponse extends HalResource {
  name: string;
  version: string;
}

// Error response
export interface ErrorResponse {
  error: string;
  message: string;
}

// Environment types
export interface EnvironmentResponse extends HalResource {
  name: string;
  displayName?: string | null;
  production: boolean;
  createdAt: string;
}

export interface EnvironmentRequest {
  displayName?: string;
  production?: boolean;
}

// Deployment types
export interface DeploymentResponse extends HalResource {
  environment: string;
  deployedAt: string;
  undeployedAt?: string | null;
}

// Consumer version selectors for pacts-for-verification
export interface ConsumerVersionSelector {
  latest?: boolean;
  tag?: string;
  consumer?: string;
  branch?: string;
  mainBranch?: boolean;
  deployed?: boolean;
  environment?: string;
}

export interface PactsForVerificationRequest {
  consumerVersionSelectors?: ConsumerVersionSelector[];
  providerVersionBranch?: string;
  includePendingStatus?: boolean;
}

export interface PactForVerification {
  verificationProperties: {
    notices: Array<{ text: string; when: string }>;
    pending: boolean;
  };
  _links: {
    self: { href: string; name: string };
  };
}

export interface PactsForVerificationResponse extends HalResource {
  _embedded: {
    pacts: PactForVerification[];
  };
}
