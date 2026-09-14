/**
 * LinkedIn publishing.
 * ---------------------
 *
 * MILESTONE 6R — uses LinkedIn's free "Share on LinkedIn" product
 * (w_member_social scope) via the current Posts API to post to the
 * connected personal profile. This is deliberately the free, self-serve
 * tier — posting to a company page instead would require the paid,
 * partner-gated Marketing Developer Platform, a materially different
 * (and expensive) path not needed for this.
 *
 * Uses POST /rest/posts, not the older /v2/ugcPosts endpoint — that
 * endpoint is deprecated; a large share of tutorials and code samples
 * still reference it, but LinkedIn's current, correctly-documented
 * endpoint for new integrations is the versioned Posts API, which
 * requires a Linkedin-Version header.
 *
 * MILESTONE 6S — reads the connection from the database (populated by
 * the OAuth connect flow) rather than static environment variables —
 * a LinkedIn access token has a real expiry, and a proper reconnect
 * flow needs somewhere to write a refreshed token to. Env vars can't
 * be updated at runtime from inside the app; the database can.
 */

import { getLinkedInConnection } from "@/lib/models/linkedinConnection";
import { LOCAL_USER_ID } from "@/lib/localUser";

export interface PublishToLinkedInResult {
  success: boolean;
  postId?: string;
  errorMessage?: string;
}

// LinkedIn's versioned API requires this header on every request, in
// YYYYMM format — set to a recent, known-good version rather than
// hardcoding something that will silently drift out of date.
const LINKEDIN_API_VERSION = "202601";

export async function publishToLinkedIn(content: string): Promise<PublishToLinkedInResult> {
  const connection = await getLinkedInConnection(LOCAL_USER_ID);

  if (!connection) {
    return {
      success: false,
      errorMessage: "LinkedIn is not connected yet — connect it from Settings first.",
    };
  }

  if (connection.expires_at && new Date(connection.expires_at).getTime() < Date.now()) {
    return {
      success: false,
      errorMessage: "The LinkedIn connection has expired — reconnect it from Settings.",
    };
  }

  const accessToken = connection.access_token;
  const personUrn = connection.person_urn;

  try {
    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "Linkedin-Version": LINKEDIN_API_VERSION,
      },
      body: JSON.stringify({
        author: personUrn,
        commentary: content,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        success: false,
        errorMessage: `LinkedIn API returned ${response.status}: ${errorBody.slice(0, 300)}`,
      };
    }

    const postId = response.headers.get("x-restli-id") ?? undefined;
    return { success: true, postId };
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : "Unknown error calling LinkedIn.",
    };
  }
}
