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
});
