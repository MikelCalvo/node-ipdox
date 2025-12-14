import { describe, it, expect } from "vitest";
import { IPDox } from "../index.js";

const RUN = process.env.RUN_INTEGRATION === "1";
const TEST_IP = process.env.TEST_IP || "8.8.8.8";

// Run only when explicitly enabled
(RUN ? describe : describe.skip)("Integration: real providers", () => {
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
		const ipdox = new IPDox({ maxRetries: 1 });
		// @ts-expect-error call provider directly to avoid randomness
		const r = await ipdox.fetchIPAPIDotCo(TEST_IP);
		expect(r).toBeTruthy();
		expect(r.source).toBe("ipapi.co");
		expect(r.ip).toBeTypeOf("string");
	}, 20_000);
});
