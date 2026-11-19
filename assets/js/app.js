/* global forge */

import { AcmeClient } from './acme-client.js';

const app = document.querySelector('#app');
const PATHS = Object.freeze({ key: '/var/local/conf/https.key', certificate: '/var/local/conf/https.pem' });
const ACME_DIRECTORIES = Object.freeze({
  staging: 'https://acme-staging-v02.api.letsencrypt.org/directory',
  production: 'https://acme-v02.api.letsencrypt.org/directory',
});
let currentUser = null;
let autoState = null;
let installedCertificate = null;

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));

const isAdmin = (user) => Array.isArray(user?.roles)
  && user.roles.some((role) => String(role).trim().toLowerCase() === 'admin');

function notice(kind, title, message) {
  return `<section class="notice notice-${kind}" role="${kind === 'danger' ? 'alert' : 'status'}"><div><strong>${escapeHtml(title)}</strong>${message}</div></section>`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(value);
}

function certificateBlock(pem) {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u)?.[0].replace(/\s+/gu, '') || null;
}

function inspectCertificate(pem) {
  const certificate = forge.pki.certificateFromPem(pem);
  const subject = certificate.subject.getField('CN')?.value || 'Unnamed certificate';
  const issuer = certificate.issuer.getField('CN')?.value || 'Unknown issuer';
  const { notBefore, notAfter } = certificate.validity;
  const isDefault = /vizulinx/i.test(subject) || /vizulinx/i.test(issuer);
  const isExpired = notAfter.getTime() <= Date.now();
  const isNotYetValid = notBefore.getTime() > Date.now();
  return { pem, subject, issuer, notBefore, notAfter, isDefault, isExpired, isNotYetValid, leaf: certificateBlock(pem) };
}

async function loadInstalledCertificate() {
  try {
    const response = await fetch(`/api/file${PATHS.certificate}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`The Gateway returned ${response.status}.`);
    return { available: true, ...inspectCertificate(await response.text()) };
  } catch (error) {
    return { available: false, error: error.message || 'The installed certificate could not be read.' };
  }
}

function certificateStatusBlade() {
  if (!installedCertificate?.available) {
    return notice('danger', 'Certificate status unavailable', `The Gateway certificate file could not be inspected. ${escapeHtml(installedCertificate?.error || '')}`);
  }
  const certificate = installedCertificate;
  let kind = 'success';
  let title = 'Custom SSL Certificate is installed correctly';
  if (certificate.isDefault) {
    kind = 'secondary';
    title = 'The default SMC Gateway certificate is installed';
  } else if (certificate.isExpired) {
    kind = 'danger';
    title = 'Custom SSL Certificate is expired';
  } else if (certificate.isNotYetValid) {
    kind = 'danger';
    title = 'Custom SSL Certificate is not yet valid';
  }
  return `<section class="notice notice-${kind}" role="status"><div><strong>${title}</strong><dl class="certificate-details"><dt>Subject</dt><dd>${escapeHtml(certificate.subject)}</dd><dt>Issuer</dt><dd>${escapeHtml(certificate.issuer)}</dd><dt>Valid from</dt><dd>${formatDate(certificate.notBefore)}</dd><dt>Expires</dt><dd>${formatDate(certificate.notAfter)}</dd></dl></div></section>`;
}

function connectionStatus() {
  return window.location.protocol === 'https:'
    ? '<span class="connection"><i class="light success"></i>HTTPS connection</span>'
    : '<span class="connection"><i class="light warning"></i>HTTP connection</span>';
}

function shell(content) {
  const route = window.location.hash || '#home';
  app.innerHTML = `<header class="site-header"><img src="./assets/images/smc-logo.svg" alt="SMC Gateway"><div><h1>SSL Certificate Manager</h1><p>Issue or install a TLS certificate for this Gateway.</p></div></header>
    <nav class="mode-nav" aria-label="Certificate manager navigation"><a class="${route === '#home' ? 'active' : ''}" href="#home">Home</a><a class="${route.startsWith('#auto') ? 'active' : ''}" href="#auto">Automatic Mode</a><a class="${route === '#manual' ? 'active' : ''}" href="#manual">Manual Mode</a><span>${connectionStatus()}</span></nav><main>${content}</main>`;
}

function renderLoading() { app.innerHTML = '<main><section class="card"><div class="card-body">Checking Gateway administrator access…</div></section></main>'; }

function renderAccessDenied(message) {
  app.innerHTML = `<header class="site-header"><img src="./assets/images/smc-logo.svg" alt="SMC Gateway"><div><h1>SSL Certificate Manager</h1></div></header><main>${notice('danger', 'Gateway administrator access required', escapeHtml(message))}<section class="card"><div class="card-body">Sign in to the Gateway as a user with the <code>admin</code> role, then return to this application.</div></section></main>`;
}

function renderHome() {
  shell(`${certificateStatusBlade()}${notice('info', 'Choose a certificate method', 'Automatic Mode requests and installs a Let’s Encrypt certificate using DNS validation. Manual Mode installs a private key and certificate you already have.')}
    <section class="choice-grid"><article class="choice-card"><h2>Automatic Mode</h2><p>Request a Let’s Encrypt certificate without exposing this Gateway to the public internet. You create one temporary DNS TXT record; the app completes the certificate request and installation.</p><p class="help">Starts in Let’s Encrypt’s staging environment for safe testing.</p><a class="button-link" href="#auto">Get a Certificate</a></article><article class="choice-card"><h2>Manual Mode</h2><p>Install a supplied unencrypted PEM private key and its PEM certificate chain. Use this if your certificate was issued by another provider.</p><a class="button-link button-secondary" href="#manual">Upload Certificate</a></article></section>
    <section class="card"><div class="card-header"><div><h2>Administrator-only utility</h2><p>Signed in as ${escapeHtml(currentUser.name || currentUser.login || 'Gateway administrator')}.</p></div></div><div class="card-body"><p>This application does not expose arbitrary Gateway file access. It can write only the two SMC-documented TLS files after confirmation.</p><ul><li><code>/var/local/conf/https.key</code></li><li><code>/var/local/conf/https.pem</code></li></ul></div></section>`);
}

function renderAutomatic() {
  shell(`${notice('warning', 'Guided DNS-01 issuance', 'The Gateway does not need to be publicly reachable. You must be able to add a temporary DNS TXT record for the requested hostname. This mode is guided issuance, not unattended renewal.')}
    <section class="card"><div class="card-header"><div><h2>Get a Let’s Encrypt Certificate</h2><p>Create a DNS-01 request for one Gateway hostname.</p></div></div><form id="auto-form" class="card-body" novalidate><div class="field"><label for="hostname">Domain Name / Hostname</label><input id="hostname" type="text" autocomplete="off" placeholder="gateway.example.com" required><p class="help">Enter one public DNS hostname. Wildcards and IP addresses are not supported in this guided flow.</p></div><div class="field"><label for="contact-email">Notification Email <span class="optional">(optional)</span></label><input id="contact-email" type="email" autocomplete="email" placeholder="administrator@example.com"><p class="help">Sent to Let’s Encrypt as an account contact. This application does not retain it.</p></div><div class="field"><label for="acme-environment">Let’s Encrypt Environment</label><select id="acme-environment"><option value="staging" selected>Staging — safe testing, browser-untrusted certificate</option><option value="production">Production — browser-trusted certificate</option></select><p class="help">Complete a successful staging request before using production.</p></div>${httpRiskAcknowledgement()}<div class="check"><input id="terms" type="checkbox" required><label for="terms">I agree that the app may create an ACME account and request a certificate from Let’s Encrypt for this hostname.</label></div><div id="auto-message"></div><div class="actions"><button id="start-order" type="submit">Create DNS Request</button></div></form></section>`);
  document.querySelector('#auto-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.querySelector('#auto-message');
    const button = document.querySelector('#start-order');
    const hostname = normaliseHostname(document.querySelector('#hostname').value);
    const email = document.querySelector('#contact-email').value.trim();
    const environment = document.querySelector('#acme-environment').value;
    if (!hostname) return showMessage(message, 'danger', 'Enter a valid hostname', 'Use a hostname such as <code>gateway.example.com</code>.');
    if (email && !document.querySelector('#contact-email').checkValidity()) return showMessage(message, 'danger', 'Enter a valid email', 'Correct the notification email or leave it blank.');
    if (!document.querySelector('#terms').checked) return showMessage(message, 'danger', 'Terms acceptance required', 'Confirm that you want to create the Let’s Encrypt request.');
    if (!httpRiskAccepted()) return showMessage(message, 'danger', 'HTTP acknowledgement required', 'Confirm the private-key transport warning before proceeding.');
    button.disabled = true;
    button.textContent = 'Creating DNS Request…';
    showMessage(message, 'info', 'Contacting Let’s Encrypt', 'Generating keys in this browser and creating the DNS-01 challenge…');
    try {
      const client = new AcmeClient(ACME_DIRECTORIES[environment]);
      await client.initialise();
      const order = await client.createOrder(hostname, email);
      autoState = { client, order, environment };
      window.location.hash = '#auto-dns';
    } catch (error) {
      showMessage(message, 'danger', 'Could not create the DNS request', escapeHtml(error.message));
      button.disabled = false;
      button.textContent = 'Create DNS Request';
    }
  });
}

function renderDnsChallenge() {
  if (!autoState) { window.location.hash = '#auto'; return; }
  const { order, environment } = autoState;
  shell(`${notice('info', 'Create the temporary DNS record', `Add this record at the DNS provider authoritative for <strong>${escapeHtml(order.hostname)}</strong>. DNS propagation can take several minutes.`)}<section class="card"><div class="card-header"><div><h2>DNS-01 Validation</h2><p>${environment === 'staging' ? 'Staging request — no browser-trusted certificate will be issued.' : 'Production request — certificate will be browser-trusted if validation succeeds.'}</p></div></div><div class="card-body"><div class="dns-record"><div><span>Type</span><code>TXT</code></div><div><span>Name</span><code>${escapeHtml(order.dnsName)}</code></div><div><span>Value</span><code>${escapeHtml(order.dnsValue)}</code></div></div><p class="help">Some DNS providers append your domain automatically. If so, enter only the record prefix they request. Do not remove the record until validation has completed.</p><div id="dns-message"></div><div class="actions"><a class="button-link button-secondary" href="#auto">Start Again</a><button id="validate-order" type="button">I Added the DNS Record — Validate</button></div></div></section>`);
  document.querySelector('#validate-order').addEventListener('click', validateOrder);
}

async function validateOrder() {
  const message = document.querySelector('#dns-message');
  const button = document.querySelector('#validate-order');
  button.disabled = true;
  showMessage(message, 'info', 'Waiting for Let’s Encrypt', 'Validation can take several minutes while public DNS propagates. Keep this page open.');
  try {
    const issued = await autoState.client.validateAndIssue(autoState.order, (stage, status) => showMessage(message, 'info', `${stage}: ${status}`, 'Waiting for Let’s Encrypt to continue…'));
    autoState = { ...autoState, issued };
    window.location.hash = '#auto-install';
  } catch (error) {
    showMessage(message, 'danger', 'Certificate request did not complete', `${escapeHtml(error.message)}<br>Check the DNS record, wait for propagation, then start a new request.`);
    button.disabled = false;
  }
}

function renderAutomaticInstall() {
  if (!autoState?.issued) { window.location.hash = '#auto'; return; }
  shell(`${notice('success', 'Certificate issued', `Let’s Encrypt issued a certificate for <strong>${escapeHtml(autoState.order.hostname)}</strong>. Install it on this Gateway now.`)}<section class="card"><div class="card-header"><div><h2>Install Issued Certificate</h2><p>The private key exists only in this browser memory until installation or page refresh.</p></div></div><div class="card-body">${httpRiskAcknowledgement()}<div class="check"><input id="confirm-auto-install" type="checkbox"><label for="confirm-auto-install">I confirm that installing this certificate may interrupt HTTPS while the Gateway reloads its TLS files.</label></div><div id="install-message"></div><div class="actions"><button id="install-issued" type="button" disabled>Install Certificate</button></div></div></section>`);
  const confirm = document.querySelector('#confirm-auto-install');
  const risk = document.querySelector('#http-risk');
  const button = document.querySelector('#install-issued');
  const update = () => { button.disabled = !confirm.checked || !httpRiskAccepted(); };
  [confirm, risk].filter(Boolean).forEach((control) => control.addEventListener('change', update));
  button.addEventListener('click', async () => installCertificate(autoState.issued.privateKeyPem, autoState.issued.certificatePem, document.querySelector('#install-message'), button));
}

function renderManual() {
  const secure = window.location.protocol === 'https:';
  shell(`${notice(secure ? 'info' : 'warning', secure ? 'Before you begin' : 'Private key transport warning', secure ? 'Upload the private key and full PEM certificate chain supplied for this Gateway hostname. The files are sent directly to this Gateway and are never stored by this application.' : 'This page runs over HTTP. The private key will travel unencrypted across the network. Use a trusted private network, or HTTPS after accepting a self-signed certificate warning.')}<section class="card"><div class="card-header"><div><h2>Install Existing SSL Certificate</h2><p>Upload a supplied PEM private key and certificate chain.</p></div></div><form id="manual-form" class="card-body" novalidate><div class="field"><label for="private-key">Private Key</label><input id="private-key" type="file" accept=".key,.pem,text/plain" required><p class="help">PEM private key only. Encrypted keys are not supported.</p></div><div class="field"><label for="certificate">Certificate Chain</label><input id="certificate" type="file" accept=".pem,.crt,.cer,text/plain" required><p class="help">PEM leaf certificate followed by any intermediate certificates.</p></div>${httpRiskAcknowledgement()}<div class="check"><input id="confirm-manual-install" type="checkbox"><label for="confirm-manual-install">I confirm that these files are for this Gateway and hostname. Replacing them may interrupt HTTPS.</label></div><div id="manual-message"></div><div class="actions"><button id="install-manual" type="submit" disabled>Install Certificate</button></div></form></section>`);
  const form = document.querySelector('#manual-form');
  const key = document.querySelector('#private-key');
  const certificate = document.querySelector('#certificate');
  const confirm = document.querySelector('#confirm-manual-install');
  const risk = document.querySelector('#http-risk');
  const button = document.querySelector('#install-manual');
  const update = () => { button.disabled = !key.files.length || !certificate.files.length || !confirm.checked || !httpRiskAccepted(); };
  [key, certificate, confirm, risk].filter(Boolean).forEach((control) => control.addEventListener('change', update));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const [keyPem, certificatePem] = await Promise.all([key.files[0].text(), certificate.files[0].text()]);
      validatePem(keyPem, certificatePem);
      await installCertificate(keyPem, certificatePem, document.querySelector('#manual-message'), button);
    } catch (error) { showMessage(document.querySelector('#manual-message'), 'danger', 'Certificate installation was not completed', escapeHtml(error.message)); }
  });
}

function httpRiskAcknowledgement() { return window.location.protocol === 'https:' ? '' : '<div class="check"><input id="http-risk" type="checkbox"><label for="http-risk">I understand that this HTTP connection can expose the private key. I have verified this is a trusted private network.</label></div>'; }
function httpRiskAccepted() { return window.location.protocol === 'https:' || document.querySelector('#http-risk')?.checked; }

function normaliseHostname(value) {
  const hostname = value.trim().toLowerCase().replace(/\.$/u, '');
  if (hostname.length > 253 || !hostname.includes('.') || /[^a-z0-9.-]/u.test(hostname)) return null;
  return hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) ? hostname : null;
}

function validatePem(key, certificate) {
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/u.test(key)) throw new Error('Encrypted private keys are not supported.');
  if (!/-----BEGIN (?:RSA |EC |)PRIVATE KEY-----[\s\S]+-----END (?:RSA |EC |)PRIVATE KEY-----/u.test(key)) throw new Error('The private-key file is not an unencrypted PEM private key.');
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/u.test(certificate)) throw new Error('The certificate file must contain at least one PEM certificate.');
}

async function installCertificate(keyPem, certificatePem, message, button) {
  if (!window.confirm('Replace the Gateway TLS private key and certificate now? This can interrupt HTTPS access while the Gateway reloads.')) return;
  button.disabled = true;
  button.textContent = 'Uploading…';
  let keyUploaded = false;
  try {
    await upload(PATHS.key, keyPem);
    keyUploaded = true;
    await upload(PATHS.certificate, certificatePem);
    const verified = await loadInstalledCertificate();
    const expectedLeaf = certificateBlock(certificatePem);
    if (!verified.available || !expectedLeaf || verified.leaf !== expectedLeaf) {
      throw new Error('The Gateway accepted the upload, but the installed public certificate could not be verified. The Gateway will not be restarted automatically.');
    }
    installedCertificate = verified;
    await requestGatewayRestart();
    renderRebooting();
  } catch (error) {
    const partial = keyUploaded ? '<br><strong>The private key was accepted, but the certificate chain was not.</strong> Retry promptly or follow the SMC recovery procedure.' : '';
    showMessage(message, 'danger', 'Certificate installation was not completed', `${escapeHtml(error.message)}${partial}`);
  } finally { button.textContent = 'Install Certificate'; button.disabled = false; }
}

async function requestGatewayRestart() {
  try {
    await fetch('/api/reboot', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    });
  } catch {
    // A successful restart commonly closes the connection before a response.
  }
}

function renderRebooting() {
  const returnUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
  const duration = 120;
  // eslint-disable-next-line quotes
  app.innerHTML = `<main class="reboot-screen"><section class="reboot-content"><img src="./assets/images/smc-logo.svg" alt="SMC Gateway"><p id="reboot-countdown" class="reboot-countdown">Rebooting in 2:00</p><div class="loader" aria-label="Gateway reboot in progress"></div><h1>SSL Certificate Installed. Rebooting.</h1><p>Please don&rsquo;t close this page. You will be automatically redirected.</p></section></main>`;
  const countdown = document.querySelector('#reboot-countdown');
  const started = Date.now();
  const timer = window.setInterval(() => {
    const remaining = Math.max(0, duration - Math.floor((Date.now() - started) / 1000));
    countdown.textContent = `Rebooting in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    if (remaining === 0) {
      window.clearInterval(timer);
      window.location.assign(returnUrl);
    }
  }, 250);
}

async function upload(path, body) {
  const response = await fetch(`/api/file${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body });
  if (response.status === 401) { window.location.assign(`/login?path=${encodeURIComponent(window.location.pathname)}`); throw new Error('Your Gateway session has expired.'); }
  if (!response.ok) throw new Error(`The Gateway rejected ${path} (${response.status}): ${await response.text().catch(() => '')}`);
}

function showMessage(target, kind, title, message) { target.innerHTML = notice(kind, title, message); }

function renderRoute() {
  switch (window.location.hash || '#home') {
    case '#auto': renderAutomatic(); break;
    case '#auto-dns': renderDnsChallenge(); break;
    case '#auto-install': renderAutomaticInstall(); break;
    case '#manual': renderManual(); break;
    default: renderHome();
  }
}

async function initialise() {
  renderLoading();
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (response.status === 401) { window.location.assign(`/login?path=${encodeURIComponent(window.location.pathname)}`); return; }
    if (!response.ok) throw new Error(`Gateway identity check failed (${response.status}).`);
    currentUser = await response.json();
    if (!isAdmin(currentUser)) { renderAccessDenied('Your signed-in Gateway account does not have the admin role.'); return; }
    installedCertificate = await loadInstalledCertificate();
    window.addEventListener('hashchange', renderRoute);
    renderRoute();
  } catch (error) { renderAccessDenied(error.message || 'The Gateway could not verify your access.'); }
}

initialise();
