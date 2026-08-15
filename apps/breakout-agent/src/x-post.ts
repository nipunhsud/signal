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

// Posts an array of tweets as a single reply-chained thread. The first element
// is the lead tweet; the rest post as sequential replies (good for a ticker
// list under the headline). Returns true only if the thread actually posted, so
// callers can gate their "mark as posted" write on real success.
export async function postXThread(tweets: string[]): Promise<boolean> {
  const c = getClient();
  if (!c || tweets.length === 0) return false;

  try {
    // 10k cap = long-form ceiling for verified/Premium accounts (well under X's
    // 25k max); short tweets pass through untouched.
    const capped = tweets.map((t) => t.slice(0, 10000));
    // A single item posts as one (long-form) tweet; multiple chain into a thread.
    if (capped.length === 1) await c.v2.tweet(capped[0]);
    else await c.v2.tweetThread(capped);
    console.log(
      `✓ Posted to X (${capped.length === 1 ? "single" : capped.length + " thread"}): ${tweets[0].split("\n")[0]}`,
    );
    return true;
  } catch (error) {
    // twitter-api-v2 stashes the real reason (duplicate content, app is
    // Read-only, etc.) in error.data — .message alone just says "code 403".
    console.error(
      "Failed to post to X:",
      (error as Error).message,
      JSON.stringify((error as any).data ?? {}),
    );
    return false;
  }
}
