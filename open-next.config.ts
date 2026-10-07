// OpenNext for Cloudflare — adapter configuration
// see https://opennext.js.org/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
  // Next.js ISR / full-route cache stored in the dedicated R2 bucket
  // (NEXT_INC_CACHE_R2_BUCKET binding in wrangler.jsonc).
  incrementalCache: r2IncrementalCache,
});
