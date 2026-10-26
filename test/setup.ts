import net from "node:net";

/**
 * Ports above 1024 that `fetch` refuses to connect to ("bad port", see the Fetch standard).
 * The tests listen on `port: 0`: where the dynamic port range starts at 1024 (e.g. Windows
 * with Hyper-V, Docker or WSL) the OS can assign one of them, and the MCP client fails at random.
 */
const FETCH_BAD_PORTS = new Set([
	1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
	6679, 6697, 10080
]);

// Servers listening on a random port listen again until they get a port allowed by `fetch`
// `listen` has many overloads: the original is called with the same arguments
const listen = net.Server.prototype.listen as (...args: unknown[]) => net.Server;
net.Server.prototype.listen = function (this: net.Server, ...args: unknown[]) {
	if (args[0] !== 0) return listen.apply(this, args);

	const callback = typeof args.at(-1) === "function" ? (args.pop() as () => void) : undefined;
	const onListening = () => {
		const { port } = this.address() as net.AddressInfo;
		if (!FETCH_BAD_PORTS.has(port)) return callback?.();
		this.close(() => listen.apply(this, [...args, onListening]));
	};
	return listen.apply(this, [...args, onListening]);
} as typeof net.Server.prototype.listen;
