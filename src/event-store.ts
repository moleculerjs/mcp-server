import { randomUUID } from "node:crypto";
import type {
	EventId,
	EventStore,
	StreamId
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * In-memory event store for SSE resumability, which keeps only the last `maxEvents` events.
 *
 * It replaces the `InMemoryEventStore` of the SDK examples, which grows without limits and
 * can't resume streams whose ID contains "_" (like the SDK standalone `_GET_stream`),
 * because it extracts the stream ID by splitting the event ID on "_".
 */
export class BoundedEventStore implements EventStore {
	// Map keeps the insertion order, so the events are in chronological order
	private readonly events = new Map<EventId, { streamId: StreamId; message: JSONRPCMessage }>();
	private readonly prefix = randomUUID();
	private counter = 0;

	constructor(private readonly maxEvents: number) {}

	get size(): number {
		return this.events.size;
	}

	async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
		const eventId = `${this.prefix}-${++this.counter}`;
		this.events.set(eventId, { streamId, message });

		while (this.events.size > this.maxEvents) {
			this.events.delete(this.events.keys().next().value!);
		}

		return eventId;
	}

	async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
		return this.events.get(eventId)?.streamId;
	}

	async replayEventsAfter(
		lastEventId: EventId,
		{ send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }
	): Promise<StreamId> {
		const last = this.events.get(lastEventId);
		// Unknown or already evicted event: nothing can be replayed
		if (!last) return "";

		let found = false;
		for (const [eventId, { streamId, message }] of this.events) {
			if (eventId === lastEventId) {
				found = true;
			} else if (found && streamId === last.streamId) {
				await send(eventId, message);
			}
		}

		return last.streamId;
	}
}
