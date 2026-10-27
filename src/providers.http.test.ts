import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AxiosInstance } from "axios";
import { IPDox } from "./index.js";
import { GeoAPIs } from "./utils/apis.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});

describe("real HTTP provider transport", () => {
	it("honors real Axios 429 errors, falls back and deduplicates cache hits", async () => {
		const requests: string[] = [];
		const server = createServer((request, response) => {
			requests.push(request.url ?? "");
			if (request.url === "/free") {
				response.writeHead(429, {
					"Retry-After": "120",
					"Content-Type": "application/json"
				});
				response.end(JSON.stringify({ error: "fixture quota" }));
			} else {
				response.writeHead(200, { "Content-Type": "application/json" });
				response.end(
					JSON.stringify({
						ip: "192.0.2.1",
						location: { country_code: "ES", latitude: 0, longitude: 0 }
					})
				);
			}
		});
		servers.push(server);
		await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
		const address = server.address() as AddressInfo;
		const client = new IPDox({ maxRetries: 2 });
		const seam = client as unknown as {
			http: AxiosInstance;
			shuffleProviders(providers: GeoAPIs[]): GeoAPIs[];
			waitWithJitter(): Promise<void>;
		};
		seam.shuffleProviders = providers => providers;
		seam.waitWithJitter = async () => {};
		seam.http.interceptors.request.use(config => ({
			...config,
			url: `http://127.0.0.1:${address.port}/${config.url?.includes("freeipapi") ? "free" : "query"}`,
			proxy: false
		}));
		const [first, second] = await Promise.all([
			client.doxIP({ ip: "192.0.2.1" }),
			client.doxIP({ ip: "192.0.2.1" })
		]);
		expect(first).toMatchObject({
			source: "ipquery.io",
			country: "ES",
			continent: "EU",
			city: "",
			latitude: 0
		});
		expect(second).toEqual(first);
		expect(requests).toEqual(["/free", "/query"]);
		expect(await client.doxIP({ ip: "192.0.2.1" })).toEqual(first);
		expect(requests).toHaveLength(2);
	});
});
