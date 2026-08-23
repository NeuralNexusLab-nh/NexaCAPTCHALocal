# NexaCAPTCHA Local

NexaCAPTCHA Local is the self-hosted edition of **NexaCAPTCHA Gravity and Algebra**. It provides the same browser loaders, completion result, and server-side verification API as the hosted service, while keeping CAPTCHA images, verification records, and tokens on infrastructure you control.

Official website: [https://nexacaptcha.nxlabtw.com](https://nexacaptcha.nxlabtw.com)

## What you get

- Drop-in browser loaders at `/captcha/gravity.js` and `/captcha/algebra.js` (with `/captcha.js` as a Gravity alias).
- Four-character Gravity image verification and two-variable Algebra verification.
- A one-time media URL, a two-minute verification window, two answer attempts, and a 20-second wait after the first incorrect answer.
- A 64-character one-time response token that expires after five minutes.
- File-backed data in `DATA_DIR`; no database is required.
- Separate shared pools of 10 Gravity and 10 Algebra images, with one image in each pool randomly replaced every six seconds.
- No telemetry and no connection to the hosted NexaCAPTCHA service.

## Requirements

- Node.js 20 or newer
- npm
- A reverse proxy with HTTPS for production use

## Install

```bash
git clone https://github.com/NeuralNexusLab-nh/NexaCAPTCHALocal.git
cd NexaCAPTCHALocal
npm install
cp .env.example .env
```

Edit `.env`, then start the service:

```bash
npm start
```

The service reads `.env` automatically. It stops at startup if an origin or resource setting is invalid.

## Configuration

```dotenv
PORT=3000
DATA_DIR=./data
SITE_ORIGIN=https://abc.com,https://abc.com.tw
HOST_ORIGIN=https://abcnexacaptcha.com,https://abcnexacaptcha.com.tw
CPU_RESOURCE_LIMIT=250m
RAM_RESOURCE_LIMIT_MB=100
STORAGE_RESOURCE_LIMIT_GB=10
```

| Variable | Format | Purpose |
| --- | --- | --- |
| `PORT` | TCP port, for example `3000` | Port used by the Node.js server. |
| `DATA_DIR` | File-system path | Stores generated images, verification records, and response tokens. Relative paths are resolved from the project directory. |
| `SITE_ORIGIN` | Comma-separated exact origins | Websites allowed to embed the widget. Include the scheme and optional port, but no path. Example: `https://abc.com,http://localhost:5173`. Wildcards are not accepted. |
| `HOST_ORIGIN` | Comma-separated exact origins | Public origins from which this service is hosted. Example: `https://captcha.abc.com,http://localhost:3000`. Loopback hosts remain available for local backend calls and health checks. |
| `CPU_RESOURCE_LIMIT` | Millicores, for example `250m` | Controls the renderer duty cycle. `1000m` represents one vCPU. This is an application-level throttle; use your container or operating system for a hard CPU quota. |
| `RAM_RESOURCE_LIMIT_MB` | Integer megabytes | Rejects new verification creation when the process RSS is above the limit. Use your hosting platform for a hard memory limit. |
| `STORAGE_RESOURCE_LIMIT_GB` | Positive number of gigabytes | Maximum tracked size of `DATA_DIR`. New records are rejected before this ceiling is exceeded. |

`SITE_ORIGIN` and `HOST_ORIGIN` are different controls. If your product runs at `https://abc.com` and NexaCAPTCHA Local runs at `https://captcha.abc.com`, use:

```dotenv
SITE_ORIGIN=https://abc.com
HOST_ORIGIN=https://captcha.abc.com
```

If a reverse proxy is used, it must replace untrusted `Host` and `X-Forwarded-Proto` headers before forwarding requests to Node.js.

## Frontend integration

Choose a module, use its official filename, and replace the hostname with your own `HOST_ORIGIN`.

Gravity:

```html
<div class="nexa-captcha"
     data-captcha-type="gravity"
     data-callback="onCaptchaComplete"></div>

<script>
  function onCaptchaComplete(result) {
    // Add result.verificationId and result.responseToken to your own form data.
    // Your backend must verify them before accepting the form.
    console.log(result);
  }
</script>

<script src="https://captcha.abc.com/captcha/gravity.js" defer></script>
```

`/captcha.js` is an alias for `/captcha/gravity.js`. The callback name and form-submission code are examples, not fixed requirements.

Algebra uses the same callback and backend verification flow. Change the module name in both places:

```html
<div class="nexa-captcha"
     data-captcha-type="algebra"
     data-callback="onCaptchaComplete"></div>

<script src="https://captcha.abc.com/captcha/algebra.js" defer></script>
```

On success, the callback receives:

```json
{
  "success": true,
  "verificationId": "ver_XXXXXXXXXXXX",
  "responseToken": "64-character-one-time-token"
}
```

## Backend verification

Your backend must send the two values to the same NexaCAPTCHA Local host:

```js
const verification = await fetch("https://captcha.abc.com/api/siteverify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ verificationId, responseToken })
});

const result = await verification.json();
if (result.success !== true) {
  throw new Error("Human verification failed");
}
```

Success:

```json
{
  "success": true,
  "verifiedAt": "2026-08-21T12:00:00.000Z"
}
```

Failure, including an invalid, expired, or already-used token:

```json
{
  "success": false,
  "errorCode": "invalid-or-expired-verification"
}
```

The token is deleted when `/api/siteverify` accepts it, so it cannot be reused.

## Compatible endpoints

The paths and JSON formats match the hosted service. Only the hostname changes.

| Method | Endpoint | Used by |
| --- | --- | --- |
| `GET` | `/captcha/gravity.js` | Your page |
| `GET` | `/captcha/algebra.js` | Your page |
| `GET` | `/captcha.js` | Gravity alias |
| `GET` | `/widget` | Browser loader |
| `POST` | `/api/verifications` | Widget |
| `POST` | `/api/algebra/verifications` | Algebra widget |
| `GET` | `/api/media/:mediaTicket` | Widget; one-time image delivery |
| `GET` | `/api/verifications/:verificationId/status` | Widget |
| `POST` | `/api/verifications/:verificationId/answer` | Widget |
| `POST` | `/api/siteverify` | Your backend |
| `GET` | `/health/live` | Health check |
| `GET` | `/health/ready` | Readiness and resource stats |

Unknown `/api/*` paths return JSON with HTTP 404. Other unknown paths return a small HTML 404 page. `/`, `/README`, `/README.md`, `/readme`, and `/readme.md` return this guide as Markdown. The license file is intentionally not exposed as a website route.

## Data layout

```text
data/
├── images/          # Shared pre-generated Gravity PNG files
│   └── algebra/     # Shared pre-generated Algebra PNG files
├── verification/    # Active verification JSON records
└── tokens/          # One-time response-token JSON records
```

Expired verification and token records are removed automatically. Protect `DATA_DIR` from direct web access and do not mount it under `public/`.

## License

NexaCAPTCHA Local is licensed under the Apache License 2.0. See `LICENSE` and `NOTICE` in this repository.
