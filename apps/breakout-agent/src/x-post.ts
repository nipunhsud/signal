import { TwitterApi } from "twitter-api-v2";

// Posts breakout digests to X (Twitter). Off unless X_POST_ENABLED=true and all
// four OAuth 1.0a user tokens are set (create them in the X developer portal for
// the account you're posting from). Fails open — a posting error never breaks a
// scan or a scheduled digest.

let client: TwitterApi | null = null;

function getClient(): TwitterApi | null {
  if (process.env.X_POST_ENABLED !== "true") return null;
  if (client) return client;

  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_SECRET;

  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    console.warn(
      "⚠ X_POST_ENABLED=true but X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET not all set — skipping X posts",
    );
    return null;
  }

  client = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
  return client;
}

// Preflight: is this container even configured to post? Lets callers report
// "env not set" distinctly from a real X API failure.
export function xPostStatus(): { ready: boolean; reason?: string } {
  if (process.env.X_POST_ENABLED !== "true") {
    return { ready: false, reason: "X_POST_ENABLED is not 'true' in this container's environment" };
  }
  const missing = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) return { ready: false, reason: `missing env: ${missing.join(", ")}` };
  return { ready: true };
}

// Detailed variant: returns WHY a post failed (env not configured, duplicate
// content, Read-only app, ...) so admin UIs can show the real reason.
// opts.mediaPng attaches an image to the FIRST tweet (media is not a link, so
// no external-link deprioritization — the visual travels with the main post).
export async function postXThreadDetailed(
  tweets: string[],
  opts?: { mediaPng?: Buffer },
): Promise<{ ok: boolean; error?: string }> {
  const status = xPostStatus();
  if (!status.ready) return { ok: false, error: status.reason };
  if (tweets.length === 0) return { ok: false, error: "no tweets to post" };
  const c = getClient()!;

  try {
    // Media upload fails open: a broken image never blocks the post itself.
    let mediaId: string | null = null;
    if (opts?.mediaPng?.length) {
      try {
        mediaId = await c.v1.uploadMedia(opts.mediaPng, { mimeType: "image/png" });
      } catch (err) {
        console.warn("X media upload failed — posting without image:", (err as Error).message);
      }
    }

    // 10k cap = long-form ceiling for verified/Premium accounts (well under X's
    // 25k max); short tweets pass through untouched.
    const capped = tweets.map((t) => t.slice(0, 10000));
    // A single item posts as one (long-form) tweet; multiple chain into a thread.
    const firstExtra = mediaId ? { media: { media_ids: [mediaId] as [string] } } : {};
    if (capped.length === 1) await c.v2.tweet(capped[0], firstExtra);
    else
      await c.v2.tweetThread(
        capped.map((text, i) => (i === 0 ? { text, ...firstExtra } : text)),
      );
    console.log(
      `✓ Posted to X (${capped.length === 1 ? "single" : capped.length + " thread"}): ${tweets[0].split("\n")[0]}`,
    );
    return { ok: true };
  } catch (error) {
    // twitter-api-v2 stashes the real reason (duplicate content, app is
    // Read-only, etc.) in error.data — .message alone just says "code 403".
    const detail = JSON.stringify((error as any).data ?? {});
    console.error("Failed to post to X:", (error as Error).message, detail);
    return {
      ok: false,
      error: `${(error as Error).message}${detail !== "{}" ? " — " + detail.slice(0, 300) : ""}`,
    };
  }
}

// Boolean wrapper kept for the digest/teaser call sites — fails open as before.
export async function postXThread(tweets: string[]): Promise<boolean> {
  return (await postXThreadDetailed(tweets)).ok;
}
