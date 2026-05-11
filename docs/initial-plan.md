# Pushover Cloudflare Build Notifications — Initial Plan

## Overview

A Cloudflare Worker that receives Workers Builds events via Queue Event Subscriptions and forwards them as push notifications to your phone via the [Pushover](https://pushover.net/) API. Designed for a single user who wants instant visibility into their Cloudflare Workers build status.

Inspired by [cloudflare/templates/workers-builds-notifications-template](https://github.com/cloudflare/templates/tree/main/workers-builds-notifications-template) (which targets Slack/Discord webhooks), this project replaces the webhook layer with Pushover's simple REST API.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────┐     ┌──────────────────┐
│ Workers Builds  │────▶│ Cloudflare Queue          │────▶│ This Worker      │
│ (any worker in  │     │ (event subscription)      │     │ (queue consumer) │
│  your account)  │     │                            │     │        │         │
└─────────────────┘     └──────────────────────────┘     └────────┼─────────┘
                                                                   │
                                                          ┌────────▼─────────┐
                                                          │ Pushover API     │
                                                          │ api.pushover.net │
                                                          │   → your phone   │
                                                          └──────────────────┘
```

1. **Any Worker** in your Cloudflare account triggers a build (push, manual, etc.)
2. **Workers Builds** publishes an event to your **Cloudflare Queue** via Event Subscriptions
3. **This consumer Worker** processes the event, formats a notification, and sends it to the **Pushover API**
4. Pushover delivers the notification to your phone (iOS, Android, Desktop)

---

## Secrets & Configuration

All sensitive values are stored as Cloudflare Worker secrets. **Nothing is hardcoded.**

| Secret / Variable    | Description                                                                                          | Required |
|----------------------|------------------------------------------------------------------------------------------------------|----------|
| `PUSHOVER_APP_TOKEN` | Your Pushover application API token (30 chars, obtained at <https://pushover.net/apps/build>)        | Yes      |
| `PUSHOVER_USER_KEY`  | Your Pushover user key (30 chars, visible on your <https://pushover.net/dashboard>)                  | Yes      |

Only **two secrets**. No Cloudflare API token is needed (we won't fetch preview/live URLs or build logs from the Cloudflare API — the event payload itself contains everything we need for a notification).

---

## Event Types Handled

From [Workers Builds Event Schema](https://developers.cloudflare.com/queues/event-subscriptions/events-schemas/#workers-builds):

| Event Type                                          | Notification Sent | Pushover Priority | Sound      |
|-----------------------------------------------------|--------------------|--------------------|------------|
| `cf.workersBuilds.worker.build.succeeded`           | ✅ Success         | `0` (normal)       | `cashregister` |
| `cf.workersBuilds.worker.build.failed`              | ❌ Failure         | `1` (high)         | `siren`    |
| `cf.workersBuilds.worker.build.failed` (cancelled)  | ⚠️ Cancelled       | `-1` (low)         | default    |
| `cf.workersBuilds.worker.build.started`             | — (acked, skipped) | —                  | —          |
| `cf.workersBuilds.worker.build.queued`              | — (acked, skipped) | —                  | —          |

**Rationale for priorities:**
- **Failed builds** get high priority (`1`) — bypasses quiet hours, red highlight in the app. You want to know about failures ASAP.
- **Succeeded builds** get normal priority (`0`) — standard notification behavior.
- **Cancelled builds** get low priority (`-1`) — no sound/vibration, just a badge update.

---

## Pushover Message Format

Pushover supports `title` + `message` + optional `url` + `url_title`. Messages are plain text (no HTML needed).

### Success Notification

```
title:   ✅ Build Succeeded — my-worker
message: Branch: main
         Commit: abc123d — Fix bug in authentication
         Author: developer
         Duration: 76s
url:     https://dash.cloudflare.com/{accountId}/workers/services/view/my-worker/production/builds/{buildUuid}
url_title: View Build
```

### Failure Notification

```
title:   ❌ Build Failed — my-worker
message: Branch: feature/auth
         Commit: def456a — WIP auth changes
         Author: developer
         
         Triggered by: push_event
url:     https://dash.cloudflare.com/{accountId}/workers/services/view/my-worker/production/builds/{buildUuid}
url_title: View Build Logs
```

### Cancelled Notification

```
title:   ⚠️ Build Cancelled — my-worker
message: Branch: staging
         Commit: ghi789b — Experiment
         Author: developer
```

> **Note:** The dashboard URL is constructed from the event payload fields (`metadata.accountId`, `source.workerName`, `payload.buildUuid`) — no API call needed.

---

## Project Structure

```
pushover-cloudflare-build-notifications/
├── src/
│   ├── index.ts        # Queue consumer entry point
│   ├── types.ts        # TypeScript interfaces (Env, CloudflareEvent, BuildStatus, PushoverResponse)
│   ├── helpers.ts      # Build status detection, branch detection, author extraction, duration calc, URL builders
│   └── pushover.ts     # Pushover API client: message formatting, HTTP POST, response handling
├── test/
│   ├── index.test.ts   # Queue consumer integration tests
│   ├── helpers.test.ts # Unit tests for helper functions
│   └── pushover.test.ts # Unit tests for Pushover message formatting
├── docs/
│   └── initial-plan.md # This file
├── wrangler.jsonc      # Worker + queue consumer configuration
├── tsconfig.json
├── package.json
├── vitest.config.mts
└── README.md           # Setup guide with Deploy to Cloudflare button
```

---

## Key Files — Design Details

### `wrangler.jsonc`

```jsonc
/**
 * For more details on how to configure Wrangler, refer to:
 * https://developers.cloudflare.com/workers/wrangler/configuration/
 */
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "pushover-build-notifications",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-10",
  "observability": {
    "enabled": true
  },
  /**
   * Secret environment variables.
   * Actual values are set via `wrangler secret put` or the dashboard.
   * Declared here so that `wrangler types` generates the correct Env interface.
   */
  "vars": {
    "PUSHOVER_APP_TOKEN": "",
    "PUSHOVER_USER_KEY": ""
  },
  "queues": {
    "consumers": [
      {
        "queue": "builds-event-subscriptions",
        "max_batch_size": 10,
        "max_batch_timeout": 30,
        "max_retries": 3
      }
    ]
  }
}
```

- Secrets are declared in `vars` with empty string placeholders so that `wrangler types` includes them in the generated `Env` interface.
- Actual secret values are set at runtime via `wrangler secret put` or the Cloudflare dashboard.
- Queue name `builds-event-subscriptions` follows the convention from the Cloudflare template.
- `max_batch_size: 10`, `max_batch_timeout: 30`, `max_retries: 3`.

### `src/types.ts`

Key types (adapted from the Cloudflare template, but without the Slack/Cloudflare API types we don't need):

Run `npx wrangler types` after configuring `wrangler.jsonc` to auto-generate `worker-configuration.d.ts` with the proper `Env` type including queue bindings. Then reference it in `tsconfig.json`:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "es2021",
    "module": "es2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": [
      "@cloudflare/vitest-pool-workers"
    ]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "worker-configuration.d.ts"]
}
```

The vitest config uses the vitest 4 plugin API (`cloudflareTest`) instead of the deprecated `poolOptions`. The file must use `.mts` extension because `@cloudflare/vitest-pool-workers` is ESM-only:

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {},
});
```

The hand-written interfaces below are for documentation purposes. `npx wrangler types` will generate the actual `Env` type:

```typescript
interface Env {
  PUSHOVER_APP_TOKEN: string;   // Pushover app API token (secret)
  PUSHOVER_USER_KEY: string;    // Pushover user key (secret)
}

interface CloudflareEvent {
  type: string;
  source: { type: string; workerName?: string; };
  payload: {
    buildUuid: string;
    status: string;
    buildOutcome: "success" | "failure" | "canceled" | "cancelled" | null;
    createdAt: string;
    initializingAt?: string;
    runningAt?: string;
    stoppedAt?: string;
    buildTriggerMetadata?: BuildTriggerMetadata;
  };
  metadata: {
    accountId: string;
    eventSubscriptionId: string;
    eventSchemaVersion: number;
    eventTimestamp: string;
  };
}

interface BuildTriggerMetadata {
  buildTriggerSource: string;
  branch: string;
  commitHash: string;
  commitMessage: string;
  author: string;
  buildCommand: string;
  deployCommand: string;
  rootDirectory: string;
  repoName: string;
  providerAccountName: string;
  providerType: string;
}

interface BuildStatus {
  isSucceeded: boolean;
  isFailed: boolean;
  isCancelled: boolean;
}

interface PushoverMessage {
  token: string;
  user: string;
  title: string;
  message: string;
  priority?: number;
  sound?: string;
  url?: string;
  url_title?: string;
}

interface PushoverResponse {
  status: number;  // 1 = success
  errors?: string[];
}
```

### `src/index.ts` — Queue Consumer

```
export default {
  async queue(batch, env): Promise<void> {
    // 1. Validate secrets are configured
    // 2. For each message in batch:
    //    a. Parse and validate event structure
    //    b. Skip started/queued events (ack only)
    //    c. Determine build status (succeeded / failed / cancelled)
    //    d. Build Pushover message
    //    e. Send to Pushover API
    //    f. Ack the message (always ack, even on error — we don't want retries for Pushover failures)
    // 3. Log any errors
  }
}
```

Key design decisions:
- **Always ack messages**: Even if Pushover fails, we don't want the queue to retry indefinitely. A transient Pushover outage shouldn't cause a backlog. The user can check worker logs for missed notifications.
- **No Cloudflare API calls**: Unlike the Slack template, we don't fetch preview URLs or build logs. The event payload has everything needed for a useful phone notification. This eliminates the need for a `CLOUDFLARE_API_TOKEN` secret entirely.

### `src/helpers.ts`

Reused and adapted from the Cloudflare template:

- `getBuildStatus(event)` — determines succeeded/failed/cancelled from event type and `buildOutcome`
- `isProductionBranch(branch)` — returns true for main/master/production/prod
- `extractAuthorName(author)` — strips email domain for cleaner display
- `getDashboardUrl(event)` — constructs Cloudflare dashboard URL from event metadata
- `getCommitUrl(event)` — constructs GitHub/GitLab commit link from metadata
- `calculateDuration(event)` — computes build duration from `createdAt` to `stoppedAt`

### `src/pushover.ts`

Pushover API integration:

- `buildPushoverMessage(event, env)` — creates a `PushoverMessage` from a build event
- `sendPushoverNotification(env, message)` — POSTs to `https://api.pushover.net/1/messages.json`

Pushover API details:
- Endpoint: `POST https://api.pushover.net/1/messages.json`
- Content-Type: `application/json`
- Required fields: `token`, `user`, `message`
- Optional fields: `title`, `priority`, `sound`, `url`, `url_title`
- Response: JSON `{ "status": 1 }` on success, `{ "status": 0, "errors": [...] }` on failure

---

## Dependencies

Minimal footprint — no runtime dependencies:

```json
{
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "0.16.3",
    "typescript": "6.0.3",
    "vitest": "4.1.5",
    "wrangler": "4.90.0"
  }
}
```

> **Note:** Do NOT install `@cloudflare/workers-types`. Instead, run `npx wrangler types` to generate a `worker-configuration.d.ts` file that is tailored to this worker's actual bindings and queue configuration. This is the recommended approach and produces more accurate types than the generic package.
>
> All dependency versions must be pinned to current latest at the time of creation. `npm outdated` must return no outdated packages.

---

## Setup Flow (README outline)

The README will guide users through these steps:

### Prerequisites
- A [Pushover](https://pushover.net/) account with the app installed on at least one device
- A Cloudflare account with Workers enabled

### Step 1: Create a Pushover Application
1. Go to <https://pushover.net/apps/build>
2. Name it (e.g., "Cloudflare Builds")
3. Copy the **API Token/Key**

### Step 2: Note Your Pushover User Key
1. Go to <https://pushover.net/dashboard>
2. Copy your **User Key**

### Step 3: Deploy the Worker
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sslboard/pushover-cloudflare-build-notifications)

### Step 4: Create the Queue
```bash
wrangler queues create builds-event-subscriptions
```

### Step 5: Set Secrets
```bash
wrangler secret put PUSHOVER_APP_TOKEN
wrangler secret put PUSHOVER_USER_KEY
```

### Step 6: Create Event Subscription
```bash
wrangler queues subscription create builds-event-subscriptions \
  --source workersBuilds.worker \
  --events build.succeeded,build.failed \
  --worker-name pushover-build-notifications
```

### Step 7: Test
Push a commit to any Worker with Builds enabled → notification appears on your phone within seconds.

---

## Deploy to Cloudflare Button

The README will include the standard Cloudflare deploy button:

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sslboard/pushover-cloudflare-build-notifications)
```

The Deploy to Cloudflare Workers experience handles:
- Forking the repo
- Installing dependencies
- Deploying the worker

The user still needs to:
1. Create the queue (manual step — can't be done from wrangler config alone)
2. Set secrets
3. Create the event subscription

---

## Testing Strategy

Using `vitest` with `@cloudflare/vitest-pool-workers`:

1. **`test/helpers.test.ts`** — Pure function unit tests:
   - `getBuildStatus` with all event types and edge cases (both "canceled"/"cancelled" spellings)
   - `isProductionBranch` with various branch names
   - `extractAuthorName` with emails and plain names
   - `getDashboardUrl` with missing fields
   - `getCommitUrl` for GitHub, GitLab, and unknown providers
   - `calculateDuration` with valid/missing timestamps

2. **`test/pushover.test.ts`** — Message formatting tests:
   - Success message format and priority
   - Failure message format and priority
   - Cancelled message format and priority
   - Fallback for unknown events
   - Mocked `fetch` for `sendPushoverNotification`

3. **`test/index.test.ts`** — Queue consumer integration tests:
   - Batch processing with multiple events
   - Skipped events (started/queued)
   - Missing secrets → graceful ack
   - Malformed event → graceful ack + error log
   - Pushover API error → graceful ack + error log

---

## Future Considerations (out of scope for v1)

- **Optional `CLOUDFLARE_API_TOKEN`** to fetch build logs and include error snippets in failure notifications
- **Per-worker sound customization** via environment variable mapping
- **Multiple Pushover users** via a configuration object
- **Deploy to Cloudflare button that auto-creates the queue** (if Cloudflare adds queue creation to the deploy flow)
