# Changelog

All notable changes to the `nirium` package are documented here.

## Unreleased

### Added

- `initX402({ policy })`: pre-sign policy hook for `x402Fetch()` ([#96](https://github.com/nirium-protocol/nirium/issues/96)). The policy is asked after the Stellar authorization is built and before anything is signed; only an `ALLOW` bound to that exact authorization (`contextHash`) and still valid reaches the signer. Optional `currentVersion` re-reads the policy version right before signing and refuses a stale `ALLOW` (not atomic with signing). Refusals throw `X402PolicyError` with an `outcome`. Without `policy`, behavior is unchanged. New exports: `X402PolicyError` and the `X402Policy*` types.
- `x402Fetch()` throws `X402SpendCapError` when `@x402/core` (2.23.0 and later) refuses a payment for being above its default per-payment cap of $1. It states the amount asked for, the cap and that the signer was not called, instead of the generic `Failed to create payment payload: ... rejected by spendControls.maxAmountPerPayment` error. Other `spendControls` rejections are unchanged. The cap itself is not exposed in `initX402()` yet. New export: `X402SpendCapError`.
- The gate accepts both auth preimage variants stellar-sdk 16 can produce, the legacy one and CAP-71 (`...WithAddress`), the latter only when bound to the signer's address.

### Changed

- `@stellar/stellar-sdk` ^16.3.0 and `@x402/fetch`/`@x402/stellar`/`@x402/core` ^2.28.0. Node.js >= 22 is now required: both declare `engines.node >=22.0.0`, and `nirium` itself now declares `engines.node >=22` so npm warns up front.

## 0.15.0 - 2026-09-24

### Added

- `x402Serve()`: optional `guard` config for replay protection and rate limiting, off by default. Providing `guard.store` turns on single-use protection against a replayed payment proof (`X-PAYMENT`/`PAYMENT-SIGNATURE`); adding `guard.rateLimit` also turns on a sliding-window rate limit per caller IP. Fails closed (503) for replay protection and open for rate limiting if the store is unavailable, matching the design already proven in a real production `x402Serve()` deployment. New exports: `X402GuardStore`, `X402GuardConfig`, `createUpstashX402GuardStore()` (a reference Upstash-backed store). See [#91](https://github.com/nirium-protocol/nirium/issues/91).

  The store interface and this feature's fail-closed/fail-open split are generalized from - and credited to - a real production integrator's own implementation: **Edgadafi/remesa-liquidez** (commit `1e0cbd5902cb224d3c6a2320cc009cf4df84f513`, `backend/src/middleware/paymentGuard.ts` and `backend/src/middleware/rateLimit.ts`). The code in this package is our own, not copied from theirs.
