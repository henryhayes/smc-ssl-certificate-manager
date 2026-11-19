# Development Notes

## Manual SSL certificate installation

- The application is intentionally restricted to Gateway administrators and uploads only the two SMC-documented TLS files: `/var/local/conf/https.key` and `/var/local/conf/https.pem`.
- It uses the Gateway File API's direct `POST /api/file<path>` upload flow. It does not provide arbitrary file browsing, download, delete or editing.
- The private key is read only to perform basic local PEM validation and is never retained, logged, displayed or persisted by the application.
- HTTPS is preferred. A first installation may need HTTP or an accepted self-signed certificate; HTTP requires an explicit user acknowledgement because it exposes the private key on the network.
- Upload success confirms only that the Gateway accepted both files. SMC must confirm the web-server reload/restart and recovery semantics before the application can claim that the certificate is active.
- The current Gateway restart action is `POST /api/reboot` with `{"confirm":true}`. A restart can close the request before a response is returned, so the application treats the request as best-effort after verifying the uploaded public certificate. It presents a two-minute recovery screen then returns to the exact current protocol, host, port and application path without forcing HTTPS.

## Testbench discovery — 19 November 2026

- The restricted `user` SSH account is not root, has no `sudo`, cannot write `/var/local/conf/cfg`, and cannot read or write the root-owned `https.key`. It can read the public `https.pem`. Direct SSH is therefore unsuitable for certificate installation; the authenticated Gateway File API remains the intended controlled write path.
- No local ACME client or general TLS utility was found (`certbot`, `acme.sh`, `lego`, `dehydrated`, `openssl`, `curl` and `wget` were unavailable). The Gateway's built-in `gw2` service owns both port 80 and port 443.
- The configured Web App module does not itself provide an HTTP-root challenge handler. A supported Gateway web-server/static-route/redirect capability must be identified before HTTP-01 ACME validation can be implemented.

## DNS-01 guided issuance

- Automatic Mode is a browser-side, guided DNS-01 ACME flow. It uses the administrator's browser to generate ephemeral RSA account and certificate keys, display the DNS TXT challenge, request validation, retrieve the certificate chain, then use the restricted File API installation flow.
- Let’s Encrypt staging is the default environment. Production is an explicit administrator selection. The browser retains no ACME or certificate private key after a page refresh and does not provide unattended renewal.
- Gateway Web Apps can initially be reached over plain HTTP, where Chromium does not expose `crypto.subtle`. Automatic Mode therefore bundles Forge locally for RSA key generation, JWS signing and CSR creation; it does not load cryptography from a CDN or rely on browser Web Crypto being available. Forge also requires its supplied `forge/prime.worker.js` at that exact app-relative path for asynchronous prime generation; it is packaged with the application.
