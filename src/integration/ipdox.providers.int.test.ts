import { describe, it, expect } from "vitest";
import { lookup } from "node:dns/promises";
import { IPDox } from "../index.js";

const RUN = process.env.RUN_INTEGRATION === "1";
const TEST_IP = process.env.TEST_IP || "8.8.8.8";

// Run only when explicitly enabled
(RUN ? describe : describe.skip)("Integration: real providers", () => {
	const canResolve = async (hostname: string): Promise<boolean> => {
		try {
			await lookup(hostname);
			return true;
		} catch (error) {
			const code =
				error && typeof error === "object"
					? (error as { code?: string }).code
					: undefined;
			if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
				return false;
			}

			throw error;
		}
	};

	it("ipwho.is", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		// @ts-expect-error call provider directly to avoid randomness
		const r = await ipdox.fetchIPWhoDotIs(TEST_IP);
		expect(r).toBeTruthy();
		expect(r.source).toBe("ipwho.is");
		expect(r.ip).toBeTypeOf("string");
	}, 20_000);

	it("ip-api.com", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		// @ts-expect-error call provider directly to avoid randomness
		const r = await ipdox.fetchIPHyphenAPIDotCom(TEST_IP);
		expect(r).toBeTruthy();
		expect(r.source).toBe("ip-api.com");
		expect(r.ip).toBeTypeOf("string");
	}, 20_000);

	it("freeipapi.com", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		// @ts-expect-error call provider directly to avoid randomness
		const r = await ipdox.fetchFreeIPAPIDotCom(TEST_IP);
		expect(r).toBeTruthy();
		expect(r.source).toBe("freeipapi.com");
		expect(r.ip).toBeTypeOf("string");
	}, 20_000);

	it("ipapi.co", async () => {
		const resolved = await canResolve("ipapi.co");
		if (!resolved) {
			return;
		}
		const ipdox = new IPDox({ maxRetries: 1 });
		// @ts-expect-error call provider directly to avoid randomness
		const r = await ipdox.fetchIPAPIDotCo(TEST_IP);
		expect(r).toBeTruthy();
		expect(r.source).toBe("ipapi.co");
		expect(r.ip).toBeTypeOf("string");
	}, 20_000);

	it("geoip.vuiz.net", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		// @ts-expect-error call provider directly to avoid randomness
		const r = await ipdox.fetchGeoIPVuizDotNet(TEST_IP);
		expect(r).toBeTruthy();
		expect(r.source).toBe("geoip.vuiz.net");
		expect(r.ip).toBeTypeOf("string");
	}, 20_000);

	it("apip.cc", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		// @ts-expect-error call provider directly to avoid randomness
		const r = await ipdox.fetchAPIPDotCC(TEST_IP);
		expect(r).toBeTruthy();
		expect(r.source).toBe("apip.cc");
		expect(r.ip).toBeTypeOf("string");
	}, 20_000);

	it("ip-sonar.com", async () => {
		const ipdox = new IPDox({ maxRetries: 1 });
		// @ts-expect-error call provider directly to avoid randomness
		const r = await ipdox.fetchIPSonarDotCom(TEST_IP);
		expect(r).toBeTruthy();
		expect(r.source).toBe("ip-sonar.com");
		expect(r.ip).toBeTypeOf("string");
	}, 20_000);
});
