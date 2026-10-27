[![NPM version][npm-version-image]][npm-url]

# Node.JS IP Doxxer

IPDox is a simple and efficient IP geolocation library for Node.js. It fetches data from multiple geolocation APIs and provides a unified response. It also includes a caching mechanism to prevent unnecessary requests.

## Providers

The default pool uses **HTTPS, no API key, no account and no payment**.
Free access is subject to each provider's rate limits and terms, not unlimited
service or a guaranteed SLA. Reviewed on 2026-10-26:

All ten providers participate in rotation; none is permanently idle as a fallback.

| Provider | Published anonymous limit | Terms / documentation |
| --- | --- | --- |
| FreeIPAPI | 10 / 10 seconds, up to 60 / minute / IP | [API](https://freeipapi.com/docs/api-reference/api-introduction), [terms](https://freeipapi.com/terms) |
| IPQuery | No numeric quota published; abuse controls apply | [API and commercial-use FAQ](https://ipquery.io/) |
| GeoJS | No fixed limit; excessive use may be throttled | [API](https://www.geojs.io/docs/), [terms](https://www.geojs.io/tos/) |
| HackMyIP | 60 / minute / IP (conservative documented limit) | [API](https://hackmyip.com/api), [terms](https://hackmyip.com/terms) |
| GeoIP Vuiz | 100 / minute / IP, fair use | [API and commercial-use FAQ](https://geoip.vuiz.net/) |
| APIP | 1 / second / IP (conservative homepage limit) | [API and commercial-use statement](https://apip.cc/) |
| Country.is | 10 / second / IP | [Docs and commercial-use FAQ](https://country.is/) |
| IP Info by Shifter | No per-application quota; finite shared capacity | [Docs](https://ip-info.com/docs), [terms](https://ip-info.com/terms) |
| IP Address Details | 100 / UTC day / IP; 120 / minute | [Docs](https://www.ipaddressdetails.com/developers), [commercial-use FAQ](https://www.ipaddressdetails.com/pages/api-comparison.html) |
| NetworkTools | 50 / UTC day / IP (stricter terms; docs say ~100) | [Docs](https://networktools.dev/api/), [business-use terms](https://networktools.dev/terms/) |

All except GeoJS explicitly advertise commercial access; GeoJS's terms cover
company use without a non-commercial restriction, but do not grant an SLA or
unrestricted usage. Check current terms before deploying. Provider diversity
does not imply independent underlying databases.

`ipApiKey` / `IPDOX_API_KEY` remains available **only as an explicit opt-in to paid
ip-api.com Pro**, for existing users. It is not needed for any default provider.
The non-commercial HTTP endpoint is never called, even when every free provider
fails. ipapi.co, ip-sonar.com and ipwho.is have been removed; see
[provider review](docs/providers.md) for the reasons and other candidates.

Each instance shuffles the pool once, then uses round-robin selection across all
eligible providers. Each lookup attempts a provider at most once, up to
`maxRetries` total network attempts. Unavailable providers do not consume attempts.
Cache hits do not rotate or consume quota.

A shared in-memory budget reserves capacity **before** dispatch across instances
using the same loaded module. Requests are spaced to conservative documented limits
(1/second for FreeIPAPI/HackMyIP/APIP, 600 ms for Vuiz, 100 ms for Country.is,
500 ms for IP Address Details). Unknown quotas use a 100 ms courtesy interval;
NetworkTools uses 1 second plus 50/day, IP Address Details 100/day. All attempted
requests count, including failures. There is no burst queue: another eligible
provider is selected immediately.

HTTP 429 honors `Retry-After` seconds/date; when absent/invalid, daily-quota
providers wait until the next UTC day and others wait 60 seconds. Other failures
pause the provider for 30 seconds. IP Address Details' remaining-day header can
reduce the local budget, never increase it. Exhaustion returns `undefined`, never
reactivates removed/paid endpoints or rotates network identities to bypass quotas.

**Boundary:** these budgets are not durable and do not coordinate separate
processes, worker isolates, duplicate installed modules, restarts or other clients
sharing the public IP. Applications must enforce aggregate quotas there. Reuse SDK
instances for cache and stable rotation. Ten providers improve resilience but do
not guarantee that one is always available.

IP Info returns `Cache-Control: no-store`: its responses are validated but never
stored in the SDK cache. Callers must also honor this restriction when
`source === "ip-info.com"`. Country.is, IP Address Details and NetworkTools entries
are capped at one hour (or the shorter configured TTL). Do not resell provider
access or redistribute a provider database; ordinary application integration and
bulk redistribution have different terms.

Unknown `city` stays an empty string; missing optional security fields stay
`undefined`, not `false`. IPQuery/HackMyIP omit continent, so it is derived locally
from country using Unicode CLDR; FreeIPAPI's `AM` is normalized to `NA`/`SA`.
Country-to-continent is a documented convention, not precise geolocation for
transcontinental territories. Responses with invalid coordinates, unknown country
codes or a different IP are not cached.

Lookups disclose the queried IP to the selected provider(s). Only send addresses
you are authorized to process; assess privacy obligations before production use.

## Upgrading to 1.2

The public constructor, request and response types are unchanged. The default
provider pool and selection policy have changed; do not rely on provider order or
on a lookup always returning a result. All providers can be temporarily unavailable
or out of capacity.

Before upgrading an application that caches or persists results outside the SDK:

- Never retain results whose `source` is `ip-info.com`, including logs, files and
  database records.
- Cap retention at one hour for `country.is`, `ipaddressdetails.com` and
  `networktools.dev`, or use a shorter application TTL.
- Review the [provider terms](docs/providers.md) and coordinate aggregate quotas
  across processes sharing an outbound IP.

The SDK applies these cache restrictions internally. CLI users must also check
`source` before saving output; piping JSON to a file does not enforce retention.

## Installation

```bash
npm install node-ipdox --save
```

## CLI Usage

You can use ipdox directly from the command line:

```bash
# Using npx (no installation required)
npx node-ipdox 8.8.8.8

# Or install globally
npm install -g node-ipdox
ipdox 8.8.8.8
```

### Examples

```bash
# Basic lookup - returns formatted JSON
ipdox 8.8.8.8

# IPv6 support
ipdox 2001:4860:4860::8888

# Pipe to jq for filtering
ipdox 1.1.1.1 | jq '.country'

# Use in scripts
COUNTRY=$(ipdox 8.8.8.8 | jq -r '.country')
echo "IP is from: $COUNTRY"
```

### CLI Options

```
ipdox <ip>              Lookup geolocation data for an IP address
ipdox --help, -h        Show help message
ipdox --version, -v     Show version number
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `IPDOX_API_KEY` | Optional paid ip-api.com Pro provider | - |
| `IPDOX_TIMEOUT` | Request timeout in milliseconds | 5000 |
| `IPDOX_RETRIES` | Maximum number of retries | 10 |

### Exit Codes

- `0` - Success, JSON output written to stdout
- `1` - Error (invalid IP, network failure, etc.), message written to stderr

## SDK Usage

```javascript
import { IPDox } from "node-ipdox";

const ipdox = new IPDox({
	cacheMaxItems: 5000,
	cacheMaxAge: 43200000,
	maxRetries: 10,
	requestTimeoutMs: 5000
});

ipdox
	.doxIP({ ip: "8.8.8.8" })
	.then(response => console.log(response))
	.catch(error => console.error(error));
```

## API

### `new IPDox({ cacheMaxItems, cacheMaxAge, maxRetries, requestTimeoutMs, ipApiKey })`

Creates a new instance of IPDox.

- `cacheMaxItems` - The maximum number of items to store in the cache (default: 1000)
- `cacheMaxAge` - The cache timeout in milliseconds (default: 43200000 (12 hours))
- `maxRetries` - Maximum total provider attempts per lookup, each provider at most once (default: 10)
- `requestTimeoutMs` - Request timeout in milliseconds (default: 5000)
- `ipApiKey` - Explicit opt-in to paid ip-api.com Pro; not needed by default

### `ipdox.doxIP({ ip })`

Fetches geolocation data for the specified IP address.

- `ip` - IP address

Returns a Promise that resolves to an `IPDOXResponse` object.

If no response is found or the IP is invalid, undefined is returned.

## IPDOXResponse

The `IPDOXResponse` object includes the following properties:

```typescript
export interface IPDOXResponse {
	ip: string; // IP address
	country: string; // Country ISO code
	city: string; // City name
	continent: string; // AF, AN, AS, EU, NA, OC or SA
	latitude: number; // Latitude
	longitude: number; // Longitude
	zip?: string; // Zip code (might be undefined)
	isp?: string; // ISP name (might be undefined)
	proxy?: boolean; // Boolean indicating if the IP address is a proxy (might be undefined)
	isHosting?: boolean; // Boolean indicating if the IP address is a hosting provider (might be undefined)
	proxyInfo?: {
		// Proxy information  (might be undefined)
		isVPN: boolean; // Boolean indicating if the IP address is a VPN (might be undefined)
		isTOR: boolean; // Boolean indicating if the IP address is a TOR node (might be undefined)
		isProxy: boolean; // Boolean indicating if the IP address is a proxy (might be undefined)
	};
	timeZone?: string; // Time zone
	source: string; // Source API
}
```

## Verification

```bash
npm ci
npm run build
npm test
npm run test:integration
TEST_IP=2001:4860:4860::8888 npm run test:integration
```

Unit tests use synthetic fixtures. Live integration is opt-in, makes one request
per default provider, and fails on DNS/HTTP/schema errors rather than silently
returning early. The paid Pro service is not exercised by the live suite.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the [ISC License](https://spdx.org/licenses/ISC).

---

[npm-url]: https://npmjs.org/package/node-ipdox
[npm-version-image]: http://img.shields.io/npm/v/node-ipdox.svg?style=flat
