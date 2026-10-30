/** Match browser task yielding when the simulation posts its own next turn. */
export function installWorkerScheduler() {
	const NativeMessageChannel = globalThis.MessageChannel;
	globalThis.MessageChannel = class extends NativeMessageChannel {
		constructor() {
			super();
			const post = this.port2.postMessage.bind(this.port2);
			// Node drains a MessagePort queue in one callback, including messages
			// posted by that callback. A sustained tick backlog can consequently
			// starve parentPort controls and ACKs forever. Defer each self-post to
			// the next check phase so other ports and timers get their turn.
			this.port2.postMessage = (...args) => {
				setImmediate(() => post(...args));
			};
		}
	};
}
