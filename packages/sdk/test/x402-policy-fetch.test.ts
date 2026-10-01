/**
 * Pre-sign policy hook (#96) - end to end through Agent.x402Fetch.
 *
 * Runs the built package (dist/, run `npm run build` first) with the real
 * @x402/fetch, @x402/core and @x402/stellar ExactStellarScheme. Only the edges
 * are simulated, in memory: the merchant's HTTP responses, Soroban RPC
 * (latest ledger + simulation) and Horizon ledger times. Keys are random and
 * unfunded; nothing is broadcast and no real network is touched.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('@stellar/stellar-sdk');
const http = require('@x402/core/http');
const { USDC_TESTNET_ADDRESS: asset } = require('@x402/stellar');
const { Agent, X402PolicyError } = require('../dist/index.js');

const MERCHANT = 'https://merchant.invalid';
const payTo = S.Keypair.random().publicKey();
let nonce = 1000;
let paidRetries = 0;
let challenges = 0;

// ── Simulated edges (patched on the same stellar-sdk instance x402 uses) ──
S.rpc.Server.prototype.getLatestLedger = async function () {
    return { sequence: 100, protocolVersion: 23, id: 'fixture' };
};
S.Horizon.Server.prototype.ledgers = function () {
    const q: any = {
        limit: () => q, order: () => q,
        call: async () => ({ records: [{ closed_at: '2026-01-01T00:00:05Z' }, { closed_at: '2026-01-01T00:00:00Z' }] }),
    };
    return q;
};
S.rpc.Server.prototype.simulateTransaction = async function (tx: any) {
    const op = tx.operations[0];
    const call = op.func.invokeContract();
    let auth = op.auth ?? [];
    if (!auth.length) {
        const from = S.Address.fromScAddress(call.args()[0].address()).toString();
        auth = [new S.xdr.SorobanAuthorizationEntry({
            credentials: S.xdr.SorobanCredentials.sorobanCredentialsAddress(new S.xdr.SorobanAddressCredentials({
                address: new S.Address(from).toScAddress(),
                nonce: S.xdr.Int64.fromString(String(++nonce)),
                signatureExpirationLedger: 0,
                signature: S.xdr.ScVal.scvVoid(),
            })),
            rootInvocation: new S.xdr.SorobanAuthorizedInvocation({
                function: S.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(call),
                subInvocations: [],
            }),
        })];
    }
    return {
        _parsed: true, id: 'fixture', latestLedger: 100, events: [], minResourceFee: '0',
        transactionData: new S.SorobanDataBuilder(), result: { auth, retval: S.xdr.ScVal.scvVoid() },
    };
};
S.rpc.Server.prototype.sendTransaction = async function () { throw new Error('BROADCAST_FORBIDDEN'); };

globalThis.fetch = async (input: any, init?: any) => {
    const req = new Request(input, init);
    if (new URL(req.url).origin !== MERCHANT) throw new Error(`NETWORK_FORBIDDEN ${req.url}`);
    const amount = new URL(req.url).searchParams.get('amount') ?? '499';
    if (req.headers.has('PAYMENT-SIGNATURE')) {
        paidRetries++;
        const payment = http.decodePaymentSignatureHeader(req.headers.get('PAYMENT-SIGNATURE'));
        const tx = S.TransactionBuilder.fromXDR(payment.payload.transaction, S.Networks.TESTNET);
        const entry = tx.operations[0].auth[0];
        const cred = entry.credentials().address();
        const pre = S.buildAuthorizationEntryPreimage(entry, cred.signatureExpirationLedger(), S.Networks.TESTNET);
        const sig = S.scValToNative(cred.signature())[0];
        const pk = S.StrKey.encodeEd25519PublicKey(Buffer.from(sig.public_key));
        assert.ok(S.Keypair.fromPublicKey(pk).verify(S.hash(pre.toXDR()), Buffer.from(sig.signature)), 'merchant got a bad signature');
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    challenges++;
    const requirements = {
        x402Version: 2,
        resource: { url: req.url, description: 'local fixture', mimeType: 'application/json' },
        accepts: [{ scheme: 'exact', network: 'stellar:testnet', asset, amount, payTo, maxTimeoutSeconds: 60, extra: { areFeesSponsored: true } }],
    };
    return new Response(JSON.stringify(requirements), {
        status: 402, headers: { 'PAYMENT-REQUIRED': http.encodePaymentRequiredHeader(requirements), 'content-type': 'application/json' },
    });
};

function keySigner(kp = S.Keypair.random(), opts: { mutate?: (p: string) => string } = {}) {
    const calls: string[] = [];
    return {
        calls, kp,
        signer: {
            address: kp.publicKey(),
            signAuthEntry: async (preimageXdr: string) => {
                calls.push(preimageXdr);
                const bytes = Buffer.from(opts.mutate ? opts.mutate(preimageXdr) : preimageXdr, 'base64');
                return { signedAuthEntry: kp.sign(S.hash(bytes)).toString('base64'), signerAddress: kp.publicKey() };
            },
        },
    };
}
const agent = () => new Agent({ apiKey: 'test-placeholder', baseUrl: 'https://backend.invalid' });
const init = (a: any, cfg: any) => a.initX402({ network: 'stellar:testnet', rpcUrl: 'https://rpc.invalid', ...cfg });
const paid = (a: any, amount = '499') => a.x402Fetch(`${MERCHANT}/resource?amount=${amount}`);

beforeEach(() => { paidRetries = 0; challenges = 0; });

test('without policy, x402Fetch pays exactly as before', async () => {
    const { calls, signer } = keySigner();
    const a = agent(); init(a, { signer });
    assert.equal((await paid(a)).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(paidRetries, 1);
});

test('ALLOW bound to the authorization pays; the engine saw URL, method and amount', async () => {
    const { calls, signer } = keySigner();
    const seen: any[] = [];
    const a = agent();
    init(a, { signer, policy: { evaluate: async (ctx: any) => { seen.push(ctx); return { decision: 'ALLOW', contextHash: ctx.contextHash }; } } });
    assert.equal((await paid(a, '777')).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(paidRetries, 1);
    assert.equal(seen[0].url, `${MERCHANT}/resource?amount=777`);
    assert.equal(seen[0].method, 'GET');
    assert.equal(seen[0].authorization.amount, '777');
    assert.equal(seen[0].authorization.to, payTo);
    assert.equal(seen[0].authorization.preimageType, 'legacy');
});

test('ALLOW also gates a raw secretKey signer', async () => {
    const a = agent();
    let asked = 0;
    init(a, { secretKey: S.Keypair.random().secret(), policy: { evaluate: async (ctx: any) => { asked++; return { decision: 'ALLOW', contextHash: ctx.contextHash }; } } });
    assert.equal((await paid(a)).status, 200);
    assert.equal(asked, 1);
    assert.equal(paidRetries, 1);
});

test('DENY: zero signer calls, no paid retry, X402PolicyError class survives @x402/fetch', async () => {
    const { calls, signer } = keySigner();
    const a = agent();
    init(a, { signer, policy: { evaluate: async () => ({ decision: 'DENY', reason: 'over budget' }) } });
    const err = await paid(a).catch((e: any) => e);
    assert.ok(err instanceof X402PolicyError, String(err));
    assert.equal(err.outcome, 'DENY');
    assert.equal(calls.length, 0);
    assert.equal(paidRetries, 0);
    assert.equal(challenges, 1);
});

test('stale ALLOW (policy revised before signing): STALE, zero signer calls, no paid retry', async () => {
    const { calls, signer } = keySigner();
    let current = 'v7';
    const a = agent();
    init(a, { signer, policy: {
        evaluate: async (ctx: any) => { current = 'v8'; return { decision: 'ALLOW', contextHash: ctx.contextHash, policyVersion: 'v7' }; },
        currentVersion: async () => current,
    } });
    const err = await paid(a).catch((e: any) => e);
    assert.ok(err instanceof X402PolicyError, String(err));
    assert.equal(err.outcome, 'STALE');
    assert.equal(calls.length, 0);
    assert.equal(paidRetries, 0);
});

test('signer identity change during evaluation: SIGNER_CHANGED, zero signer calls', async () => {
    const { calls, signer } = keySigner();
    const a = agent();
    init(a, { signer, policy: { evaluate: async (ctx: any) => { signer.address = S.Keypair.random().publicKey(); return { decision: 'ALLOW', contextHash: ctx.contextHash }; } } });
    const err = await paid(a).catch((e: any) => e);
    assert.equal(err.outcome, 'SIGNER_CHANGED');
    assert.equal(calls.length, 0);
    assert.equal(paidRetries, 0);
});

// Garantía que da stellar-sdk >= 16 (authorizeEntry verifica la firma contra
// sha256(preimage)), no el gate. Este test la ata al camino real de x402Fetch.
test('a signature over altered bytes never reaches the merchant (stellar-sdk check)', async () => {
    const mutate = (p: string) => {
        const pre = S.xdr.HashIdPreimage.fromXDR(p, 'base64');
        pre.sorobanAuthorization().invocation().function().contractFn().args()[2] = S.nativeToScVal('1', { type: 'i128' });
        return pre.toXDR('base64');
    };
    const { calls, signer } = keySigner(undefined, { mutate });
    const a = agent();
    init(a, { signer, policy: { evaluate: async (ctx: any) => ({ decision: 'ALLOW', contextHash: ctx.contextHash }) } });
    await assert.rejects(paid(a), (e: any) => e.message.includes("signature doesn't match payload"));
    assert.equal(calls.length, 1);
    assert.equal(paidRetries, 0);
});

test('initX402 rejects a malformed policy before any payment', () => {
    const { signer } = keySigner();
    assert.throws(() => init(agent(), { signer, policy: {} }), /policy\.evaluate/);
    assert.throws(() => init(agent(), { signer, policy: { evaluate: async () => ({}), currentVersion: 'v7' } }), /currentVersion/);
    assert.throws(() => init(agent(), { signer, policy: { evaluate: async () => ({}), timeoutMs: 0 } }), /timeoutMs/);
});
