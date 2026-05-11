/**
 * Cloudflare Workers Builds → Pushover Notifications
 *
 * This worker consumes build events from a Cloudflare Queue and sends
 * push notifications to your phone via the Pushover API.
 *
 * - Success: normal priority with cashregister sound, includes dashboard link
 * - Failure: high priority (bypasses quiet hours) with siren sound
 * - Cancelled: low priority, silent notification
 *
 * @see https://developers.cloudflare.com/queues/event-subscriptions/
 * @see https://pushover.net/api
 */

import type { CloudflareEvent } from "./types";
import { getBuildStatus } from "./helpers";
import { buildPushoverMessage, sendPushoverNotification } from "./pushover";

export default {
	async queue(
		batch: MessageBatch<CloudflareEvent>,
		env: Env,
	): Promise<void> {
		if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) {
			console.error(
				"Missing secrets: set PUSHOVER_APP_TOKEN and PUSHOVER_USER_KEY",
			);
			for (const message of batch.messages) {
				message.ack();
			}
			return;
		}

		for (const message of batch.messages) {
			try {
				const event = message.body;

				// Validate event structure
				if (!event?.type || !event?.payload || !event?.metadata) {
					console.error(
						"Invalid event structure:",
						JSON.stringify(event),
					);
					message.ack();
					continue;
				}

				// Skip started/queued events — no notification needed
				if (
					event.type.includes("started") ||
					event.type.includes("queued")
				) {
					message.ack();
					continue;
				}

				// Only process terminal states
				const status = getBuildStatus(event);
				if (!status.isSucceeded && !status.isFailed && !status.isCancelled) {
					console.warn("Unhandled event type:", event.type);
					message.ack();
					continue;
				}

				// Build and send Pushover notification
				const pushoverMessage = buildPushoverMessage(event, env);
				const result = await sendPushoverNotification(pushoverMessage);

				if (!result.ok) {
					console.error(
						"Pushover API error:",
						result.errors?.join(", ") || "unknown",
					);
					message.retry();
					continue;
				}

				message.ack();
			} catch (error) {
				console.error("Error processing message:", error);
				message.retry();
			}
		}
	},
} satisfies ExportedHandler<Env, CloudflareEvent>;
