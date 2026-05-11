# Pushover Cloudflare Build Notifications

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sslboard/pushover-cloudflare-build-notifications)

Get **Cloudflare Workers build notifications on your phone** via [Pushover](https://pushover.net/). This Worker consumes build events from a Cloudflare Queue and forwards them as push notifications with appropriate priority, sound, and direct links to the Cloudflare dashboard.

## Features

- 🔔 Real-time push notifications for build success, failure, and cancellation
- 🚨 Failed builds sent with **high priority** (bypasses quiet hours) and siren sound
- 🔗 Direct link to the build in the Cloudflare dashboard
- 📋 Build details: worker name, branch, commit, author, duration
- 🔒 Only two secrets to configure — no hardcoded values

## How It Works

```
┌─────────────────┐     ┌──────────────────────────┐     ┌──────────────────┐     ┌──────────┐
│ Workers Builds  │────▶│ Cloudflare Queue          │────▶│ This Worker      │────▶│ Pushover │
│ (any worker in  │     │ (event subscription)      │     │ (queue consumer) │     │ → Phone  │
│  your account)  │     │                            │     │                  │     │          │
└─────────────────┘     └──────────────────────────┘     └──────────────────┘     └──────────┘
```

1. **Any Worker** in your Cloudflare account triggers a build
2. **Workers Builds** publishes an event to your **Cloudflare Queue** via Event Subscriptions
3. **This consumer Worker** formats the event and sends it to the **Pushover API**
4. Pushover delivers the notification to your phone

## Notification Examples

| Build Status | Priority | Sound | Notification |
|---|---|---|---|
| ✅ Succeeded | Normal (0) | `cashregister` | Branch, commit, message, author, duration + link |
| ❌ Failed | High (1) — bypasses quiet hours | `siren` | Branch, commit, trigger source + link |
| ⚠️ Cancelled | Low (-1) — silent | *(default)* | Branch, commit, author |

## Setup

### Prerequisites

- A [Pushover](https://pushover.net/) account with the app installed on at least one device (iOS, Android, or Desktop)
- A Cloudflare account with [Workers](https://developers.cloudflare.com/workers/) enabled

### Step 1: Create a Pushover Application

1. Go to [pushover.net/apps/build](https://pushover.net/apps/build)
2. Name it (e.g., "Cloudflare Builds") and optionally upload an icon
3. Copy the **API Token/Key** (30 characters)

### Step 2: Note Your Pushover User Key

1. Go to your [Pushover dashboard](https://pushover.net/dashboard)
2. Copy your **User Key** (30 characters)

### Step 3: Deploy the Worker

Click the button below to deploy via the Cloudflare dashboard:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sslboard/pushover-cloudflare-build-notifications)

Or deploy manually:

```bash
git clone https://github.com/sslboard/pushover-cloudflare-build-notifications.git
cd pushover-cloudflare-build-notifications
npm install
wrangler deploy
```

### Step 4: Create the Queue

> **Important:** The queue must exist before the worker can consume from it.

```bash
wrangler queues create builds-event-subscriptions
```

Or via the [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/workers/queues) → **Create Queue** → name it `builds-event-subscriptions`.

### Step 5: Set Secrets

```bash
wrangler secret put PUSHOVER_APP_TOKEN
# Paste your Pushover application API token

wrangler secret put PUSHOVER_USER_KEY
# Paste your Pushover user key
```

Or via the Cloudflare Dashboard → Workers → your worker → **Settings** → **Variables and Secrets**.

### Step 6: Create the Event Subscription

Subscribe your queue to Workers Builds events so that builds emit events into your queue:

```bash
wrangler queues subscription create builds-event-subscriptions \
  --source workersBuilds.worker \
  --events build.succeeded,build.failed \
  --worker-name pushover-build-notifications
```

Or via the Cloudflare Dashboard → [Queues](https://dash.cloudflare.com/?to=/:account/workers/queues) → your queue → **Subscriptions** tab → **Subscribe to events** → source: **Workers Builds** → select events → **Subscribe**.

### Step 7: Test It!

Push a commit to any Worker in your account that has [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) enabled. You should receive a Pushover notification on your phone within seconds.

## Event Types

| Event | Notification |
|---|---|
| `cf.workersBuilds.worker.build.succeeded` | ✅ Success notification with dashboard link |
| `cf.workersBuilds.worker.build.failed` | ❌ High-priority failure notification |
| `cf.workersBuilds.worker.build.failed` (cancelled) | ⚠️ Low-priority cancellation notice |
| `cf.workersBuilds.worker.build.started` | Skipped (no notification) |
| `cf.workersBuilds.worker.build.queued` | Skipped (no notification) |

## Event Schema

Workers Builds events follow this structure (see [Cloudflare docs](https://developers.cloudflare.com/queues/event-subscriptions/events-schemas/#workers-builds)):

```json
{
  "type": "cf.workersBuilds.worker.build.succeeded",
  "source": {
    "type": "workersBuilds.worker",
    "workerName": "my-worker"
  },
  "payload": {
    "buildUuid": "build-12345678-90ab-cdef-1234-567890abcdef",
    "status": "success",
    "buildOutcome": "success",
    "createdAt": "2025-05-01T02:48:57.132Z",
    "stoppedAt": "2025-05-01T02:50:15.132Z",
    "buildTriggerMetadata": {
      "buildTriggerSource": "push_event",
      "branch": "main",
      "commitHash": "abc123def456",
      "commitMessage": "Fix bug in authentication",
      "author": "developer@example.com",
      "repoName": "my-worker-repo",
      "providerAccountName": "github-user",
      "providerType": "github"
    }
  },
  "metadata": {
    "accountId": "your-account-id",
    "eventSubscriptionId": "sub-1234",
    "eventSchemaVersion": 1,
    "eventTimestamp": "2025-05-01T02:48:57.132Z"
  }
}
```

## Configuration

### Secrets

| Secret | Description |
|---|---|
| `PUSHOVER_APP_TOKEN` | Your Pushover application API token |
| `PUSHOVER_USER_KEY` | Your Pushover user key |

### Queue Settings (wrangler.jsonc)

| Setting | Default | Description |
|---|---|---|
| `max_batch_size` | 10 | Messages processed per batch |
| `max_batch_timeout` | 30 | Seconds to wait for a full batch |
| `max_retries` | 3 | Retry attempts for failed processing |

## Development

```bash
# Install dependencies
npm install

# Generate types (do NOT install @cloudflare/workers-types)
npx wrangler types

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Local development
npm run dev

# View live logs
npm run tail
```

## Troubleshooting

### No notifications appearing

1. **Check the queue** — [Dashboard → Queues](https://dash.cloudflare.com/?to=/:account/workers/queues) → your queue. Are messages arriving?
2. **Check worker logs** — Dashboard → Workers → your worker → **Logs**
3. **Verify subscription** — Queues → your queue → **Subscriptions** tab
4. **Verify secrets** — Workers → your worker → **Settings** → **Variables and Secrets**

### Deploy fails with "Queue does not exist"

Create the queue first (see [Step 4](#step-4-create-the-queue)).

### Pushover returns "invalid token"

- Verify `PUSHOVER_APP_TOKEN` is the **application** token from [pushover.net/apps](https://pushover.net/apps), not your user key
- Verify `PUSHOVER_USER_KEY` is from your [dashboard](https://pushover.net/dashboard)

### Build events not appearing in the queue

- Ensure you have [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) enabled on at least one worker
- Ensure the event subscription includes the event types you expect (at minimum `build.succeeded` and `build.failed`)

## Learn More

- [Pushover Message API](https://pushover.net/api)
- [Cloudflare Queue Event Subscriptions](https://developers.cloudflare.com/queues/event-subscriptions/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Builds Event Schema](https://developers.cloudflare.com/queues/event-subscriptions/events-schemas/#workers-builds)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)

## License

MIT
