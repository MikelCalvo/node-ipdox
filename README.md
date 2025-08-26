[![NPM version][npm-version-image]][npm-url]

# Node.JS IP Doxxer

IPDox is a simple and efficient IP geolocation library for Node.js. It fetches data from multiple geolocation APIs and provides a unified response. It also includes a caching mechanism to prevent unnecessary requests.

## Installation

```bash
npm install node-ipdox --save
```

## Usage

```javascript
import { IPDox } from "node-ipdox";

const ipdox = new IPDox({
	cacheMaxItems: 5000,
	cacheMaxAge: 43200000,
	maxRetries: 10
});

ipdox
	.doxIP({ ip: "8.8.8.8" })
	.then(response => console.log(response))
	.catch(error => console.error(error));
```

## API

### `new IPDox({ cacheMaxItems, cacheMaxAge, maxRetries })`

Creates a new instance of IPDox.

- `cacheMaxItems` - The maximum number of items to store in the cache (default: 1000)
- `cacheMaxAge` - The cache timeout in milliseconds (default: 43200000 (12 hours))
- `maxRetries` - Maximum number of retries if an API request fails (default: 10)

### `ipdox.doxIP({ ip })`

Fetches geolocation data for the specified IP address.

- `ip` - IP address

Returns a Promise that resolves to an `IPDOXResponse` object.

If no response is found, undefined is returned.

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
	zip: string; // Zip code
	isp: string; // ISP name
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
