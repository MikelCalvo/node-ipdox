[![NPM version][npm-version-image]][npm-url]

# Node.JS IP Doxxer

IPDox is a simple and efficient IP geolocation library for Node.js. It fetches data from multiple geolocation APIs and provides a unified response. It also includes a caching mechanism to prevent unnecessary requests.

## Providers

Current keyless providers used:

- ip-api.com
- ipwho.is
- freeipapi.com
- ipapi.co

Note: ip-api.com free tier uses HTTP only. Provide `ipApiKey` to enable HTTPS (pro).

Fallback providers (best-effort, used after primary providers fail):

- geoip.vuiz.net
- apip.cc
- ip-sonar.com

Fallback providers can return partial data; `city` may be an empty string when unknown.

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

# Save to file
ipdox 8.8.8.8 > result.json

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
| `IPDOX_API_KEY` | ip-api.com Pro API key for HTTPS support | - |
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
	requestTimeoutMs: 5000,
	ipApiKey: "YOUR_IP_API_KEY"
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
- `maxRetries` - Maximum number of retries if an API request fails (default: 10)
- `requestTimeoutMs` - Request timeout in milliseconds (default: 5000)
- `ipApiKey` - Optional ip-api.com pro API key to enable HTTPS

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
	continent: string; // Continent ISO code
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

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the [ISC License](https://spdx.org/licenses/ISC).

---

[npm-url]: https://npmjs.org/package/node-ipdox
[npm-version-image]: http://img.shields.io/npm/v/node-ipdox.svg?style=flat
