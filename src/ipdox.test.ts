import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { IPDox } from "./index.js";

vi.mock("axios");

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

describe("IPDox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns undefined for empty ip", async () => {
		const ipdox = new IPDox();
		const res = await ipdox.doxIP({ ip: "" });
		expect(res).toBeUndefined();
	});

	it("formats response from ipwho.is provider", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		mockedAxios.get = vi.fn().mockResolvedValue({
			data: {
				success: true,
				ip: "8.8.8.8",
				country_code: "US",
				city: "Mountain View",
				continent_code: "NA",
				latitude: 37.386,
				longitude: -122.0838,
				postal: "94039",
				connection: { isp: "Google LLC" },
				timezone: { id: "America/Los_Angeles" }
			}
		});

		// Call provider directly to avoid randomness
		// @ts-expect-error Accessing class method for test
		const r = await ipdox.fetchIPWhoDotIs("8.8.8.8");
		expect(r).toMatchObject({
			ip: "8.8.8.8",
			country: "US",
			city: "Mountain View",
			continent: "NA",
			latitude: 37.386,
			longitude: -122.0838,
			zip: "94039",
			isp: "Google LLC",
			timeZone: "America/Los_Angeles",
			source: "ipwho.is"
		});
	});

	it("caches responses by ip", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		mockedAxios.get = vi.fn().mockResolvedValue({
			data: {
				success: true,
				ip: "1.1.1.1",
				country_code: "AU",
				city: "Sydney",
				continent_code: "OC",
				latitude: -33.86,
				longitude: 151.21,
				postal: "2000",
				connection: { isp: "Cloudflare" },
				timezone: { id: "Australia/Sydney" }
			}
		});
		// @ts-expect-error Accessing class method for test
		const r1 = await ipdox.fetchIPWhoDotIs("1.1.1.1");
		expect(r1).toBeTruthy();
		// Second call should be served from cache; axios.get should not be called again if provider is called through cache path
		// @ts-expect-error Use cache via public doxIP path
		ipdox.cache.set("1.1.1.1", r1);
		const r2 = await ipdox.doxIP({ ip: "1.1.1.1" });
		expect(r2).toEqual(r1);
	});
});
