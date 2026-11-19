/* global forge */

// The Gateway initially serves Web Apps over HTTP. Chromium deliberately hides
// Web Crypto's SubtleCrypto API in that context, so ACME key generation and
// signing use the locally bundled, browser-compatible Forge implementation.
function base64Url(binary) {
  return forge.util.encode64(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function jsonPart(value) {
  return base64Url(forge.util.encodeUtf8(JSON.stringify(value)));
}

function sha256(value) {
  const digest = forge.md.sha256.create();
  digest.update(value, 'utf8');
  return digest.digest().getBytes();
}

function positiveIntegerBytes(value) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return forge.util.hexToBytes(hex);
}

function publicJwk(publicKey) {
  return { e: 'AQAB', kty: 'RSA', n: base64Url(positiveIntegerBytes(publicKey.n)) };
}

function generateKeyPair() {
  return new Promise((resolve, reject) => {
    // Do not use Forge's optional prime-generation worker: Web Apps are served
    // beneath /a/<app>/ and the worker URL is not a Gateway-hosted asset.
    forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001, workers: 0 }, (error, pair) => {
      if (error) reject(error);
      else resolve(pair);
    });
  });
}

function errorDetail(response, payload = null) {
  const detail = payload?.detail || payload?.type || response.statusText;
  return `Let’s Encrypt request failed (${response.status})${detail ? `: ${detail}` : ''}`;
}

async function responseJson(response) {
  try { return await response.json(); } catch { return null; }
}

export class AcmeClient {
  constructor(directoryUrl) {
    this.directoryUrl = directoryUrl;
    this.directory = null;
    this.account = null;
    this.accountJwk = null;
    this.accountKid = null;
    this.certificateKey = null;
    this.certificatePrivatePem = null;
    this.nonce = null;
  }

  async initialise() {
    if (!window.forge) throw new Error('The certificate cryptography library did not load. Refresh this page and try again.');
    const response = await fetch(this.directoryUrl);
    if (!response.ok) throw new Error(errorDetail(response, await responseJson(response)));
    this.directory = await response.json();
    if (!this.directory.newNonce || !this.directory.newAccount || !this.directory.newOrder) {
      throw new Error('The selected ACME directory is missing required endpoints.');
    }
    return this.directory;
  }

  async createOrder(hostname, email) {
    await this.createAccount(email);
    await this.createCertificateKey();
    const response = await this.signedRequest(this.directory.newOrder, {
      identifiers: [{ type: 'dns', value: hostname }],
    });
    const order = await responseJson(response);
    if (!response.ok) throw new Error(errorDetail(response, order));
    const authorizationUrl = order.authorizations?.[0];
    if (!authorizationUrl || !order.finalize) throw new Error('Let’s Encrypt returned an incomplete certificate order.');
    const authorizationResponse = await this.postAsGet(authorizationUrl);
    const authorization = await responseJson(authorizationResponse);
    if (!authorizationResponse.ok) throw new Error(errorDetail(authorizationResponse, authorization));
    const challenge = authorization.challenges?.find((item) => item.type === 'dns-01');
    if (!challenge) throw new Error('Let’s Encrypt did not offer a DNS-01 challenge for this hostname.');
    const keyAuthorization = `${challenge.token}.${this.thumbprint()}`;
    return {
      hostname,
      orderUrl: response.headers.get('Location'),
      order,
      authorizationUrl,
      challengeUrl: challenge.url,
      dnsName: `_acme-challenge.${hostname}`,
      dnsValue: base64Url(sha256(keyAuthorization)),
    };
  }

  async validateAndIssue(orderState, onPoll = () => {}) {
    const acknowledge = await this.signedRequest(orderState.challengeUrl, {});
    if (!acknowledge.ok && acknowledge.status !== 200) {
      throw new Error(errorDetail(acknowledge, await responseJson(acknowledge)));
    }
    const authorization = await this.poll(orderState.authorizationUrl, 'DNS validation', onPoll);
    if (authorization.status !== 'valid') throw new Error(`DNS validation ended with status: ${authorization.status}.`);
    const finalize = await this.signedRequest(orderState.order.finalize, { csr: this.createCsr(orderState.hostname) });
    const finalOrder = await responseJson(finalize);
    if (!finalize.ok) throw new Error(errorDetail(finalize, finalOrder));
    const completeOrder = await this.poll(orderState.orderUrl, 'Certificate issuance', onPoll);
    if (completeOrder.status !== 'valid' || !completeOrder.certificate) {
      throw new Error(`Certificate issuance ended with status: ${completeOrder.status}.`);
    }
    const certificateResponse = await this.postAsGet(completeOrder.certificate);
    const certificatePem = await certificateResponse.text();
    if (!certificateResponse.ok || !certificatePem.includes('-----BEGIN CERTIFICATE-----')) {
      throw new Error(`Let’s Encrypt did not return a PEM certificate chain (${certificateResponse.status}).`);
    }
    return { privateKeyPem: this.certificatePrivatePem, certificatePem };
  }

  async createAccount(email) {
    this.account = await generateKeyPair();
    this.accountJwk = publicJwk(this.account.publicKey);
    const contact = email ? [`mailto:${email}`] : [];
    const response = await this.signedRequest(this.directory.newAccount, { termsOfServiceAgreed: true, contact }, true);
    const account = await responseJson(response);
    if (!response.ok && response.status !== 409) throw new Error(errorDetail(response, account));
    this.accountKid = response.headers.get('Location');
    if (!this.accountKid) throw new Error('Let’s Encrypt did not return an ACME account location.');
  }

  async createCertificateKey() {
    this.certificateKey = await generateKeyPair();
    this.certificatePrivatePem = forge.pki.privateKeyToPem(this.certificateKey.privateKey);
  }

  async signedRequest(url, payload, useJwk = false, retry = true) {
    if (!this.nonce) await this.getNonce();
    const protectedHeader = {
      alg: 'RS256', nonce: this.nonce, url,
      ...(useJwk ? { jwk: this.accountJwk } : { kid: this.accountKid }),
    };
    const protectedPart = jsonPart(protectedHeader);
    const payloadPart = payload === null ? '' : jsonPart(payload);
    const digest = forge.md.sha256.create();
    digest.update(`${protectedPart}.${payloadPart}`, 'utf8');
    const signature = base64Url(this.account.privateKey.sign(digest));
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/jose+json' },
      body: JSON.stringify({ protected: protectedPart, payload: payloadPart, signature }),
    });
    this.nonce = response.headers.get('Replay-Nonce');
    if (retry && response.status === 400) {
      const payloadError = await response.clone().json().catch(() => null);
      if (payloadError?.type?.endsWith(':badNonce')) return this.signedRequest(url, payload, useJwk, false);
    }
    return response;
  }

  async postAsGet(url) { return this.signedRequest(url, null); }

  async getNonce() {
    const response = await fetch(this.directory.newNonce, { method: 'HEAD' });
    this.nonce = response.headers.get('Replay-Nonce');
    if (!this.nonce) throw new Error('Let’s Encrypt did not provide an ACME replay nonce.');
  }

  thumbprint() {
    return base64Url(sha256(JSON.stringify({ e: this.accountJwk.e, kty: 'RSA', n: this.accountJwk.n })));
  }

  createCsr(hostname) {
    const request = forge.pki.createCertificationRequest();
    request.publicKey = this.certificateKey.publicKey;
    request.setSubject([{ name: 'commonName', value: hostname }]);
    request.setAttributes([{
      name: 'extensionRequest',
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] }],
    }]);
    request.sign(this.certificateKey.privateKey, forge.md.sha256.create());
    return base64Url(forge.asn1.toDer(forge.pki.certificationRequestToAsn1(request)).getBytes());
  }

  async poll(url, label, onPoll) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const response = await this.postAsGet(url);
      const result = await responseJson(response);
      if (!response.ok) throw new Error(errorDetail(response, result));
      onPoll(label, result.status, attempt + 1);
      if (result.status === 'valid') return result;
      if (result.status === 'invalid') throw new Error(result.error?.detail || `${label} was rejected by Let’s Encrypt.`);
      await new Promise((resolve) => { window.setTimeout(resolve, 5000); });
    }
    throw new Error(`${label} did not complete in time. You may need to restart the request after DNS propagation.`);
  }
}
