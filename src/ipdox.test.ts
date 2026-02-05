import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { IPDox } from "./index.js";

vi.mock("axios");

const mockedAxios = axios as unknown as { create: ReturnType<typeof vi.fn> };
let mockedGet: ReturnType<typeof vi.fn>;

describe("IPDox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedGet = vi.fn();
		mockedAxios.create = vi.fn(() => ({ get: mockedGet }));
	});

	it("returns undefined for empty ip", async () => {
		const ipdox = new IPDox();
		const res = await ipdox.doxIP({ ip: "" });
		expect(res).toBeUndefined();
	});

	it("returns undefined for invalid ip", async () => {
		const ipdox = new IPDox();
		const res = await ipdox.doxIP({ ip: "not-an-ip" });
		expect(res).toBeUndefined();
	});

	it("formats response from ipwho.is provider", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		mockedGet.mockResolvedValue({
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

	it("uses ip-api.com pro endpoint when key is provided", async () => {
		const ipdox = new IPDox({ maxRetries: 1, ipApiKey: "testkey" });
		mockedGet.mockResolvedValue({
			data: {
				status: "success",
				query: "1.1.1.1",
				countryCode: "AU",
				city: "Sydney",
				continentCode: "OC",
				lat: -33.86,
				lon: 151.21,
				zip: "2000",
				isp: "Cloudflare",
				proxy: false,
				hosting: false,
				timezone: "Australia/Sydney"
			}
		});

		// @ts-expect-error Accessing class method for test
		const r = await ipdox.fetchIPHyphenAPIDotCom("1.1.1.1");
		expect(r.source).toBe("ip-api.com");
		expect(mockedGet).toHaveBeenCalledWith(
			"https://pro.ip-api.com/json/1.1.1.1?fields=24899583&key=testkey"
		);
	});

	it("formats response from geoip.vuiz.net provider", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		mockedGet.mockResolvedValue({
			data: {
				ip: "8.8.8.8",
				continent: "North America",
				country: "United States",
				countryCode: "US",
				region: "California",
				city: "Mountain View",
				lat: 37.386,
				lon: -122.0838,
				timezone: "America/Los_Angeles",
				isp: "Google LLC"
			}
		});

		// Call provider directly to avoid randomness
		// @ts-expect-error Accessing class method for test
		const r = await ipdox.fetchGeoIPVuizDotNet("8.8.8.8");
		expect(r).toMatchObject({
			ip: "8.8.8.8",
			country: "US",
			city: "Mountain View",
			continent: "NA",
			latitude: 37.386,
			longitude: -122.0838,
			isp: "Google LLC",
			timeZone: "America/Los_Angeles",
			source: "geoip.vuiz.net"
		});
	});

	it("formats response from apip.cc provider", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		mockedGet.mockResolvedValue({
			data: {
				status: "success",
				ip: "1.1.1.1",
				CountryCode: "AU",
				City: "Sydney",
				ContinentCode: "OC",
				Latitude: "-33.86",
				Longitude: "151.21",
				Postal: "2000",
				org: "Cloudflare",
				TimeZone: "Australia/Sydney"
			}
		});

		// Call provider directly to avoid randomness
		// @ts-expect-error Accessing class method for test
		const r = await ipdox.fetchAPIPDotCC("1.1.1.1");
		expect(r).toMatchObject({
			ip: "1.1.1.1",
			country: "AU",
			city: "Sydney",
			continent: "OC",
			latitude: -33.86,
			longitude: 151.21,
			zip: "2000",
			isp: "Cloudflare",
			timeZone: "Australia/Sydney",
			source: "apip.cc"
		});
	});

	it("formats response from ip-sonar.com provider", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		mockedGet.mockResolvedValue({
			data: {
				ip: "216.8.112.107",
				continent_code: "NA",
				country_code: "US",
				city_name: "Cleveland",
				latitude: 41.4377,
				longitude: -81.5487,
				postal_code: "44128",
				timezone: "America/New_York"
			}
		});

		// Call provider directly to avoid randomness
		// @ts-expect-error Accessing class method for test
		const r = await ipdox.fetchIPSonarDotCom("216.8.112.107");
		expect(r).toMatchObject({
			ip: "216.8.112.107",
			country: "US",
			city: "Cleveland",
			continent: "NA",
			latitude: 41.4377,
			longitude: -81.5487,
			zip: "44128",
			timeZone: "America/New_York",
			source: "ip-sonar.com"
		});
	});

	it("caches responses by ip", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		mockedGet.mockResolvedValue({
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
