# SMC Gateway SSL Certificate Manager

An administrator-only SMC Gateway Web App for inspecting, issuing and installing the Gateway TLS certificate.

It manages only the two SMC-documented files:

```text
/var/local/conf/https.key
/var/local/conf/https.pem
```

## Features

- Shows the currently installed public certificate by reading the Gateway PEM file.
  - Grey: the default `vizulinx` SMC certificate.
  - Green: a valid custom certificate.
  - Red: an expired, not-yet-valid, invalid or unreadable certificate.
- **Automatic Mode** obtains a single-hostname Let’s Encrypt certificate using DNS-01 validation.
- **Manual Mode** installs an unencrypted PEM private key and PEM certificate chain supplied by another certificate authority.
- Verifies the uploaded public certificate before requesting a Gateway restart.
- Requests the documented Gateway reboot endpoint, then displays a two-minute recovery screen before returning to the same origin, port and app path used to open the app.

## Access

The app has no separate login page. It uses the Gateway session and requires the signed-in user to have the `admin` role. Gateway File API permissions remain the server-side protection for TLS file writes.

## Installation

1. Build the deployment ZIP:

   ```powershell
   npm install
   npm run package
   ```

2. In Gateway Develop → Modules, add or update a **Web App** module.
3. Upload `.deployments/smc-ssl-certificate-manager-v<version>.zip` using the standard Gateway Web App upload flow.
4. Set its application path, for example:

   ```text
   smc-ssl-certificate-manager
   ```

5. Open the resulting Gateway URL while signed in as an administrator:

   ```text
   http(s)://<gateway-host>/a/smc-ssl-certificate-manager/
   ```

The ZIP contains the app contents directly; do not add a containing folder when uploading.

## Automatic Mode: Let’s Encrypt DNS-01

Automatic Mode is a guided certificate issue flow:

1. Enter one public hostname and choose Let’s Encrypt staging or production.
2. The app creates an ACME account and order in browser memory.
3. Add the displayed `_acme-challenge` TXT record at the hostname’s authoritative DNS provider.
4. Select **Validate** once the record has propagated.
5. After successful issuance, confirm installation.

The account key and certificate private key exist only in browser memory for the current page session. This is guided issuance, not unattended renewal.

Use staging first. A Let’s Encrypt staging certificate is intentionally untrusted by browsers and should not be installed on a live Gateway unless that interruption is acceptable.

## Manual Mode

Manual Mode accepts:

- An unencrypted PEM private key.
- A PEM certificate chain, with the leaf certificate first followed by any intermediates.

Encrypted private keys are not supported.

## Security and network considerations

- Prefer HTTPS when uploading a private key. A first TLS installation may need HTTP or acceptance of an existing self-signed certificate; the app requires an explicit acknowledgement before sending a key over HTTP.
- DNS-01 validation does not require the Gateway to be publicly reachable.
- The hostname’s public DNS, any firewall/NAT rules, and any reverse proxy or CDN must still route browser HTTPS traffic to the intended Gateway TLS listener.
- If a proxy such as Cloudflare is used, its edge certificate must cover the public hostname separately from the Gateway origin certificate.
- The reboot request may close before a response is received. The app treats that as expected and waits two minutes before reloading the same current origin and application path; it never forces a new hostname or HTTP/HTTPS scheme.

## Development

```powershell
npm install
npm run lint
npm run package
```

`npm run package` validates the configured package inputs, minifies the staged JavaScript, and creates:

```text
.deployments/smc-ssl-certificate-manager-v<version>.zip
```

`package-lock.json` is committed to keep development and release builds reproducible. `node_modules/` and `.deployments/` are generated and ignored.

## Project files

- `assets/js/app.js` — user interface, certificate inspection, File API writes and reboot handoff.
- `assets/js/acme-client.js` — browser-side ACME DNS-01 client.
- `assets/vendor/forge.min.js` and `forge/prime.worker.js` — locally bundled browser cryptography required when the Gateway app is initially accessed over HTTP, where browser Web Crypto may be unavailable.
- `scripts/package.ps1` — deployment ZIP packager.
- `DEVELOPMENT_NOTES.md` — verified Gateway behaviour and operational decisions.
