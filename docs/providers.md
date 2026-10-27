# Keyless provider review

Reviewed 2026-10-26. The default SDK pool is listed in the README. This review
separates endpoint availability from permission to use it. An HTTP 200 alone
is not evidence of free commercial entitlement.

## Added

- **IPQuery:** public HTTPS endpoint, no key or registration; its
  [official FAQ](https://ipquery.io/) expressly permits commercial applications,
  SaaS and internal tools. Anonymous IPv4 and IPv6 lookups were exercised. Nested
  location/ISP/risk fields are normalized without inventing missing booleans.
- **GeoJS:** public HTTPS single-IP object endpoint (not the array-returning query
  form). [General docs](https://www.geojs.io/docs/general/) state no current fixed
  limits; [terms](https://www.geojs.io/tos/) cover company use and allow throttling
  excessive requests. They do not explicitly promise unrestricted commercial use.
  The workstation resolver returns ENOTFOUND for get.geojs.io; public DNS resolves
  it and a TLS-verified diagnostic request works. No DNS bypass or pinned provider
  address is included in the library. See the verification handoff for which
  network context passed; a local DNS failure remains a failed live test.
  Both IPv4 and IPv6 passed using an isolated diagnostic DNS override with normal
  certificate validation; native-resolver failures remain reported separately.
- **HackMyIP:** [API page](https://hackmyip.com/api) explicitly says free for personal
  and commercial use, no signup/key. [Docs](https://hackmyip.com/api-docs) list
  60/minute/IP, while observed headers advertise 100; use the conservative 60.
  The arbitrary-IP lookup lacks the continent/VPN fields present on its self-IP
  endpoint; the adapter does not assume the two schemas are identical.

## Additional providers and balancing

- **Country.is:** [official docs/FAQ](https://country.is/) explicitly permit free
  commercial usage with no key; its current `fields=city,continent,postal,location,asn`
  option provides the required coordinates, not just country. No signup.
  10/second/IP infrastructure limit. IPv4 and IPv6 both passed.
- **IP Info by Shifter:** [docs](https://ip-info.com/docs) and
  [terms](https://ip-info.com/terms) permit anonymous commercial application access.
  No per-app quota is promised, but capacity is finite and abuse prohibited.
  Its no-store responses must not be cached by SDK **or consumers**. Connection
  classifications and anycast are not converted into invented proxy/VPN flags.
- **IP Address Details:** [docs](https://www.ipaddressdetails.com/developers) permit
  100 anonymous requests per UTC day/IP, with 120/minute burst cap. Its
  [official comparison FAQ](https://www.ipaddressdetails.com/pages/api-comparison.html)
  permits commercial use and says no attribution is required. Paid or free-key
  tiers are not used. Cache cap is one hour; remaining-day headers only reduce budget.
- **NetworkTools:** [terms](https://networktools.dev/terms/) explicitly allow
  integration for legitimate business purposes but prohibit commercial data
  redistribution without permission. Terms say **50/day/IP**, [docs](https://networktools.dev/api/)
  say around 100/day, and live headers advertise a much higher per-minute ceiling.
  Adopt the strictest 50/day; never treat headers as permission to raise it.
  Live schema includes `geo.countryCode`; `geo.country` can be a name, unlike its
  simplified docs. Prefer the actual ISO code; never label a country name as ISO.

All ten take turns; the old primary/fallback split no longer starves reserves.
Round-robin starts from a per-instance randomized order. Shared per-module capacity
is synchronously reserved before awaiting HTTP, so concurrent instances cannot
overspend that in-memory budget. Pacing and daily counters prevent known-limit
hammering; failed attempts count too. Shared cooldown honors Retry-After and falls
back to next UTC midnight for daily-quota providers. Restart, multiple processes,
workers and unrelated NAT clients require application-level coordination. No
network-identity rotation or quota bypass is implemented.

## Retained and corrected

- **FreeIPAPI:** [canonical free API](https://freeipapi.com/docs/api-reference/api-introduction)
  is `https://free.freeipapi.com/api/v1/json/{ip}` without account/whitelisting/key.
  Commercial use is advertised on its [homepage](https://freeipapi.com/).
  [Limits](https://freeipapi.com/rate-limit): 10/10 seconds and up to 60/minute;
  [terms](https://freeipapi.com/terms) disallow bypassing quotas and bulk scraping.
  Map current `isProxy` and `asnOrganization`, and split continent `AM` by country.
- **Vuiz:** [official API/FAQ](https://geoip.vuiz.net/) permits commercial use under
  fair use, with 100/minute/IP, no signup/key. Included in rotation.
- **APIP:** [homepage](https://apip.cc/) permits commercial/non-commercial use with
  no registration/key and says 1/second/IP; [docs](https://apip.cc/docs.html) say
  10/second. Use the conservative 1/second in rotation.

## Removed from anonymous operation

- **ip-api.com free:** [official restrictions](https://ip-api.com/docs/api:json)
  forbid commercial use and only support HTTP. Retain only the explicitly keyed
  HTTPS Pro adapter to preserve the public constructor option. No live paid call.
- **ipapi.co:** [pricing](https://ipapi.co/pricing) restricts free access to testing
  and development, not production/deployment. [Terms](https://ipapi.co/terms) also
  restrict caching/reuse. Public-DNS diagnosis shows it is alive; it was **not**
  removed on a claim that local DNS failure proves permanent shutdown.
- **ipwho.is:** [documentation](https://ipwhois.io/documentation) advertises keyless
  free access but [terms section 3.1](https://ipwhois.io/terms) says users must
  register with email. Excluded conservatively because this contradicts the
  no-registration requirement; do not describe the endpoint as broken.
- **ip-sonar.com:** TLS handshake fails (EPROTO / TLS alert), including with the
  previous release. Current terms cannot be verified. Remove the adapter and
  dispatch entry; there is no verified announcement of permanent closure.

## Candidates not added

- **ipapi.is:** [anonymous tier](https://ipapi.is/free-tier.html) is only 30/day/IP,
  lacks country ISO/continent and moved security flags behind account/key access.
- **ip.guide:** public endpoint works, but no clear current quota/commercial-use
  statement was located. Its country name is not an ISO code; ASN country is not
  a substitute for geolocation country.
- **reallyfreegeoip.org:** 403 in verification and current terms not confirmed.
  Do not infer worldwide shutdown from this environment's response.

Additional candidates screened for the expanded pool:

- **IPSnapshot:** [API](https://ipsnapshot.com/ip-lookup-api) responds, but payload
  lacks latitude/longitude and IPv6 is country-level. Its [terms](https://ipsnapshot.com/terms)
  say 100/day while docs say 500/day. Not added: do not fabricate missing coordinates.
- **ipgeolocationapi.io:** [docs](https://ipgeolocationapi.io/docs) offer anonymous
  5,000/day and [terms](https://ipgeolocationapi.io/terms) allow use in products;
  both bounded IPv4/IPv6 checks returned 502. Keep as a candidate, not a healthy adapter.
- **IP.SB:** [pricing](https://ip.sb/pricing/) expressly excludes commercial and
  production use from the free tier. No probe needed.
- **IPWho.org:** [rate-limit docs](https://ipwho.org/docs/guides/rate-limits) restrict
  the free tier to personal/testing/non-profit use; not a commercial keyless candidate.
- **IPPubblico / golive.ly:** official [IPPubblico docs](https://ippubblico.org/docs.html)
  and [golive.ly docs](https://golive.ly/ip/docs) expose caller-IP detection, not a
  documented arbitrary-IP geolocation endpoint. Not useful for this SDK's contract.

## Mapping and compatibility

No new runtime package dependencies. Public constructor/request/response shapes
are retained; private retired adapters are deleted. Missing city remains empty,
not a country/region name. Optional boolean fields remain absent unless supplied.
The response's IP, recognized country/continent and finite coordinate ranges are
checked before caching. Canonical IPv6 forms compare equal.

The country-to-continent table is derived from [Unicode CLDR at a pinned commit](https://github.com/unicode-org/cldr-json/blob/91c267402229a59e3ef2774544f001bf959e8809/cldr-json/cldr-core/supplemental/territoryContainment.json).
Americas are split using regions 003 and 005; AQ is assigned AN. This is a
country-level convention. Unicode License v3 attribution is included in the
source and emitted JavaScript, including the npm archive.

Retries are bounded by both maxRetries and pool size. See the README for pacing,
daily quotas and cache restrictions. Free services can change terms, throttle or
disappear; no availability or perpetual-free guarantee is made.
