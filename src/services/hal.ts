import type { HalLinks, HalLink } from "../types";

/**
 * Helper to build HAL _links for API responses
 */
export class HalBuilder {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Remove trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  link(path: string, title?: string, templated?: boolean): HalLink {
    const link: HalLink = { href: `${this.baseUrl}${path}` };
    if (title) link.title = title;
    if (templated) link.templated = true;
    return link;
  }

  // Common link patterns
  index(): HalLinks {
    return {
      self: this.link("/"),
      "pb:pacticipants": this.link("/pacticipants", "Pacticipants"),
      "pb:latest-pact-versions": this.link(
        "/pacts/latest",
        "Latest pact versions"
      ),
      "pb:pact": this.link(
        "/pacts/provider/{provider}/consumer/{consumer}/latest",
        "Latest pact by consumer/provider",
        true
      ),
      "pb:provider-pacts-for-verification": this.link(
        "/pacts/provider/{provider}/for-verification",
        "Pact versions to verify for the specified provider",
        true
      ),
      "pb:environments": this.link("/environments", "Environments"),
    };
  }

  pacticipant(name: string): HalLinks {
    return {
      self: this.link(`/pacticipants/${encodeURIComponent(name)}`),
      "pb:versions": this.link(
        `/pacticipants/${encodeURIComponent(name)}/versions`,
        "Versions"
      ),
    };
  }

  version(pacticipant: string, version: string): HalLinks {
    const p = encodeURIComponent(pacticipant);
    const v = encodeURIComponent(version);
    return {
      self: this.link(`/pacticipants/${p}/versions/${v}`),
      "pb:pacticipant": this.link(`/pacticipants/${p}`),
      "pb:tags": this.link(`/pacticipants/${p}/versions/${v}/tags`, "Tags"),
    };
  }

  tag(pacticipant: string, version: string, tagName: string): HalLinks {
    const p = encodeURIComponent(pacticipant);
    const v = encodeURIComponent(version);
    const t = encodeURIComponent(tagName);
    return {
      self: this.link(`/pacticipants/${p}/versions/${v}/tags/${t}`),
      "pb:version": this.link(`/pacticipants/${p}/versions/${v}`),
    };
  }

  pact(
    provider: string,
    consumer: string,
    version: string,
    contentSha: string
  ): HalLinks {
    const pr = encodeURIComponent(provider);
    const co = encodeURIComponent(consumer);
    const v = encodeURIComponent(version);
    return {
      self: this.link(`/pacts/provider/${pr}/consumer/${co}/version/${v}`),
      "pb:consumer": this.link(`/pacticipants/${co}`),
      "pb:provider": this.link(`/pacticipants/${pr}`),
      "pb:consumer-version": this.link(`/pacticipants/${co}/versions/${v}`),
      "pb:publish-verification-results": this.link(
        `/pacts/provider/${pr}/consumer/${co}/pact-version/${contentSha}/verification-results`,
        "Publish verification results"
      ),
      "pb:latest-pact-version": this.link(
        `/pacts/provider/${pr}/consumer/${co}/latest`
      ),
    };
  }

  verification(
    provider: string,
    consumer: string,
    pactSha: string,
    verificationId: number
  ): HalLinks {
    const pr = encodeURIComponent(provider);
    const co = encodeURIComponent(consumer);
    return {
      self: this.link(
        `/pacts/provider/${pr}/consumer/${co}/pact-version/${pactSha}/verification-results/${verificationId}`
      ),
      "pb:pact-version": this.link(
        `/pacts/provider/${pr}/consumer/${co}/latest`
      ),
    };
  }

  matrix(): HalLinks {
    return {
      self: this.link("/matrix"),
    };
  }

  canIDeploy(): HalLinks {
    return {
      self: this.link("/can-i-deploy"),
    };
  }

  environment(name: string): HalLinks {
    const n = encodeURIComponent(name);
    return {
      self: this.link(`/environments/${n}`),
    };
  }

  deployment(pacticipant: string, version: string, environment: string): HalLinks {
    const p = encodeURIComponent(pacticipant);
    const v = encodeURIComponent(version);
    const e = encodeURIComponent(environment);
    return {
      self: this.link(`/pacticipants/${p}/versions/${v}/deployed/${e}`),
      "pb:version": this.link(`/pacticipants/${p}/versions/${v}`),
      "pb:environment": this.link(`/environments/${e}`),
    };
  }

  pactsForVerification(provider: string): HalLinks {
    const pr = encodeURIComponent(provider);
    return {
      self: this.link(`/pacts/provider/${pr}/for-verification`),
      "pb:provider": this.link(`/pacticipants/${pr}`),
    };
  }
}

/**
 * Extract base URL from request
 */
export function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
