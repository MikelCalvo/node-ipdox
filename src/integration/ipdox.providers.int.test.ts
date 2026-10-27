import { describe, it, expect } from "vitest";
import { IPDox, type IPDOXResponse } from "../index.js";

const RUN = process.env.RUN_INTEGRATION === "1";
const TEST_IP = process.env.TEST_IP || "8.8.8.8";
const PROVIDERS = [
	["freeipapi.com", "fetchFreeIPAPIDotCom"],
	["ipquery.io", "fetchIPQueryDotIO"],
	["geojs.io", "fetchGeoJSDotIO"],
	["hackmyip.com", "fetchHackMyIPDotCom"],
	["geoip.vuiz.net", "fetchGeoIPVuizDotNet"],
	["apip.cc", "fetchAPIPDotCC"],
	["country.is", "fetchCountryDotIs"],
	["ip-info.com", "fetchIPInfoDotCom"],
	["ipaddressdetails.com", "fetchIPAddressDetailsDotCom"],
	["networktools.dev", "fetchNetworkToolsDotDev"]
] as const;

// Real, bounded, keyless calls only when explicitly enabled. DNS/HTTP failures
// fail the test: never report a provider as passing after an early return.
(RUN ? describe : describe.skip)("Integration: real keyless providers", () => {
	it.each(PROVIDERS)(
		"%s",
		async (source, method) => {
			const client = new IPDox({ maxRetries: 1 });
			let result: IPDOXResponse;
			try {
				result = await (
					client as unknown as Record<
						string,
						(ip: string) => Promise<IPDOXResponse>
					>
				)[method](TEST_IP);
			} catch (error) {
				// Axios errors include raw provider payloads and request metadata.
				const failure = error as
					{ code?: string; response?: { status?: number } } | undefined;
				throw new Error(
					`${source}: provider unavailable (code=${failure?.code ?? "none"}, status=${failure?.response?.status ?? "none"})`
				);
			}
			expect(result.source).toBe(source);
			expect(result.country).toMatch(/^[A-Z]{2}$/);
			expect(result.continent).toMatch(/^(AF|AN|AS|EU|NA|OC|SA)$/);
			expect(result.city).toBeTypeOf("string");
			expect(Number.isFinite(result.latitude)).toBe(true);
			expect(Number.isFinite(result.longitude)).toBe(true);
			expect(Math.abs(result.latitude)).toBeLessThanOrEqual(90);
			expect(Math.abs(result.longitude)).toBeLessThanOrEqual(180);
		},
		20_000
	);
});
