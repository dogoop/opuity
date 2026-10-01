// ═══════════════════════════════════════════════════════════════
// Pre-sign policy hook for x402Fetch (#96).
//
// El punto de evaluación envuelve al signer SEP-43 porque es el único lugar
// donde existe la autorización que se va a firmar: ExactStellarScheme la arma
// dentro de createPaymentPayload (simulación RPC incluida) y stellar-sdk la
// entrega a signAuthEntry como HashIdPreimage en base64. El hook
// onBeforePaymentCreation de @x402/core corre ANTES de eso: ve los requisitos,
// pero todavía no hay nonce, expiración ni invocación que atar.
// ═══════════════════════════════════════════════════════════════

import { xdr, hash, Networks, Address, scValToNative } from '@stellar/stellar-sdk';

export type X402PolicyVerdict = 'ALLOW' | 'DENY' | 'WAIT';

export interface X402PaymentRequirementsView {
    scheme: string;
    network: string;
    asset: string;
    payTo: string;
    amount: string;
    maxTimeoutSeconds: number;
}

export interface X402PolicyContext {
    /** Version of this object's shape, so an engine knows what it is reading. */
    contextVersion: 1;
    /** URL and method exactly as passed to x402Fetch. */
    url: string;
    method: string;
    /** The requirements the server asked for and x402 selected. */
    requirements: Readonly<X402PaymentRequirementsView>;
    /** What is actually about to be signed, decoded from the bytes. */
    authorization: Readonly<{
        preimageXdr: string;
        /** 'legacy' (ENVELOPE_TYPE_SOROBAN_AUTHORIZATION) or 'cap71' (…WithAddress). */
        preimageType: 'legacy' | 'cap71';
        /** sha256(preimage) in hex: exactly the payload ed25519 signs. */
        payloadHash: string;
        networkPassphrase: string;
        nonce: string;
        signatureExpirationLedger: number;
        contractId: string;
        functionName: string;
        from: string;
        to: string;
        amount: string;
    }>;
    signer: string;
    /** sha256 of {url, method, payloadHash}. An ALLOW must echo it back unchanged. */
    contextHash: string;
}

export interface X402PolicyDecision {
    decision: X402PolicyVerdict;
    /** Required on ALLOW: binds the decision to this authorization and no other. */
    contextHash?: string;
    reason?: string;
    /**
     * Opaque to Nirium. Preserved in errors and onDecision. Required on ALLOW
     * when `currentVersion` is configured: it is what gets compared.
     */
    policyVersion?: string;
    /** Epoch ms. If it has passed by signing time, nothing is signed. Equality counts as expired. */
    expiresAt?: number;
    decisionId?: string;
}

export type X402PolicyOutcome =
    | 'SIGNED' | 'DENY' | 'WAIT' | 'TIMEOUT' | 'ENGINE_ERROR'
    | 'EXPIRED' | 'UNBOUND' | 'MALFORMED' | 'CONTEXT_MISMATCH'
    | 'STALE' | 'VERSION_UNAVAILABLE' | 'SIGNER_CHANGED';

export interface X402PolicyRecord {
    outcome: X402PolicyOutcome;
    context?: X402PolicyContext;
    decision?: X402PolicyDecision;
    error?: string;
}

/**
 * Pre-sign policy hook (#96). Runs after the Stellar authorization is built
 * and before anything is signed. Only an ALLOW bound to this exact
 * authorization, and still valid, reaches the signer. Anything else (DENY,
 * WAIT, error, timeout, malformed or stale answer) signs nothing. Nirium never
 * stores or owns the policy; it asks and obeys.
 *
 * Authorizations that are not a single `transfer(from, to, amount)` matching
 * the selected requirements are rejected before the policy is consulted.
 */
export interface X402PolicyHook {
    evaluate: (ctx: X402PolicyContext, opts: { signal: AbortSignal }) => Promise<X402PolicyDecision>;
    /**
     * Optional source of the policy version currently in force. When set, it is
     * read after an ALLOW and right before signing; the ALLOW signs only if its
     * `policyVersion` equals what this returns. A rejection, an empty answer or
     * running past the deadline signs nothing.
     *
     * This check is NOT atomic with signing: the version can change after it is
     * read, or while the signer runs. It narrows the stale-ALLOW window to the
     * synchronous step between this read and the signer call; it does not close it.
     */
    currentVersion?: (ctx: X402PolicyContext, opts: { signal: AbortSignal }) => Promise<string>;
    /**
     * Hard deadline for the whole pre-sign phase (evaluate + currentVersion).
     * Default 5000 ms, and never more than half the payment's maxTimeoutSeconds.
     */
    timeoutMs?: number;
    /** If true, an ALLOW without expiresAt is treated as unsignable. Default false. */
    requireExpiry?: boolean;
    /** Observer for receipts. Cannot change the outcome; its errors are swallowed. */
    onDecision?: (record: X402PolicyRecord) => void;
    /** Injectable clock (epoch ms), for tests. */
    now?: () => number;
}

export class X402PolicyError extends Error {
    readonly outcome: Exclude<X402PolicyOutcome, 'SIGNED'>;
    readonly decision?: X402PolicyDecision;
    readonly contextHash?: string;
    constructor(
        outcome: Exclude<X402PolicyOutcome, 'SIGNED'>,
        message: string,
        extra: { decision?: X402PolicyDecision; contextHash?: string } = {},
    ) {
        super(`x402 policy ${outcome}: ${message}`);
        this.name = 'X402PolicyError';
        this.outcome = outcome;
        this.decision = extra.decision;
        this.contextHash = extra.contextHash;
    }
}

const PASSPHRASES: Record<string, string> = {
    'stellar:testnet': Networks.TESTNET,
    'stellar:pubnet': Networks.PUBLIC,
};

const DEFAULT_TIMEOUT_MS = 5000;

const hex = (b: Buffer | Uint8Array) => Buffer.from(b).toString('hex');
const sha256hex = (s: string) => hex(hash(Buffer.from(s, 'utf8')));
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

type SignOpts = { networkPassphrase?: string; address?: string };
type SignFn = (authEntry: string, opts?: SignOpts) =>
    Promise<{ signedAuthEntry: string; signerAddress?: string }>;
export type X402BaseSigner = { address: string; signAuthEntry: SignFn };

/** Validates a policy hook at initX402 time, so bad config fails before any payment. */
export function assertValidPolicyHook(policy: X402PolicyHook): void {
    if (!policy || typeof policy !== 'object' || typeof policy.evaluate !== 'function') {
        throw new Error('initX402: `policy.evaluate` must be a function.');
    }
    if (policy.currentVersion !== undefined && typeof policy.currentVersion !== 'function') {
        throw new Error('initX402: `policy.currentVersion`, when set, must be a function.');
    }
    if (policy.timeoutMs !== undefined
        && (!Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0)) {
        throw new Error('initX402: `policy.timeoutMs` must be a positive integer (ms).');
    }
}

/**
 * Decodes the preimage and checks it describes exactly the payment x402
 * selected. This is not policy (that belongs to the engine): it is context
 * integrity, so that what the engine evaluates is what gets signed.
 */
export function describeAuthorization(
    preimageXdr: string,
    requirements: X402PaymentRequirementsView,
    signerAddress: string,
): X402PolicyContext['authorization'] {
    let pre: any;
    try {
        pre = xdr.HashIdPreimage.fromXDR(preimageXdr, 'base64');
    } catch (e: any) {
        throw new X402PolicyError('CONTEXT_MISMATCH', `undecodable auth preimage (${e?.message})`);
    }
    // Dos variantes: la clásica, y la de CAP-71 que además ata la dirección
    // dentro de lo firmado. En la segunda, esa dirección tiene que ser el signer.
    let auth: any;
    let preimageType: 'legacy' | 'cap71';
    switch (pre.switch().name) {
        case 'envelopeTypeSorobanAuthorization':
            auth = pre.sorobanAuthorization();
            preimageType = 'legacy';
            break;
        case 'envelopeTypeSorobanAuthorizationWithAddress':
            auth = pre.sorobanAuthorizationWithAddress();
            preimageType = 'cap71';
            if (Address.fromScAddress(auth.address()).toString() !== signerAddress) {
                throw new X402PolicyError('CONTEXT_MISMATCH', 'CAP-71 preimage is bound to a different address than the signer');
            }
            break;
        default:
            throw new X402PolicyError('CONTEXT_MISMATCH', `unsupported preimage type ${pre.switch().name}`);
    }
    const passphrase = PASSPHRASES[requirements.network];
    if (!passphrase) throw new X402PolicyError('CONTEXT_MISMATCH', `unknown network ${requirements.network}`);
    if (hex(auth.networkId()) !== hex(hash(Buffer.from(passphrase)))) {
        throw new X402PolicyError('CONTEXT_MISMATCH', 'auth entry is for a different network than requirements.network');
    }
    const inv = auth.invocation();
    if (inv.subInvocations().length !== 0) {
        throw new X402PolicyError('CONTEXT_MISMATCH', 'auth entry carries sub-invocations');
    }
    const fn = inv.function();
    if (fn.switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') {
        throw new X402PolicyError('CONTEXT_MISMATCH', `unexpected authorized function ${fn.switch().name}`);
    }
    const call = fn.contractFn();
    const contractId = Address.fromScAddress(call.contractAddress()).toString();
    const functionName = call.functionName().toString();
    const rawArgs = call.args();
    if (functionName !== 'transfer' || rawArgs.length !== 3) {
        throw new X402PolicyError('CONTEXT_MISMATCH', `expected transfer(from,to,amount), got ${functionName}/${rawArgs.length}`);
    }
    if (rawArgs[0].switch().name !== 'scvAddress' || rawArgs[1].switch().name !== 'scvAddress'
        || rawArgs[2].switch().name !== 'scvI128') {
        throw new X402PolicyError('CONTEXT_MISMATCH', 'transfer arguments have unexpected types');
    }
    const from = Address.fromScAddress(rawArgs[0].address()).toString();
    const to = Address.fromScAddress(rawArgs[1].address()).toString();
    const amount = BigInt(scValToNative(rawArgs[2])).toString();
    if (contractId !== requirements.asset) throw new X402PolicyError('CONTEXT_MISMATCH', 'asset contract differs from requirements.asset');
    if (to !== requirements.payTo) throw new X402PolicyError('CONTEXT_MISMATCH', 'destination differs from requirements.payTo');
    if (amount !== requirements.amount) throw new X402PolicyError('CONTEXT_MISMATCH', 'amount differs from requirements.amount');
    if (from !== signerAddress) throw new X402PolicyError('CONTEXT_MISMATCH', 'from differs from signer address');
    return Object.freeze({
        preimageXdr,
        preimageType,
        payloadHash: hex(hash(pre.toXDR())),
        networkPassphrase: passphrase,
        nonce: auth.nonce().toString(),
        signatureExpirationLedger: auth.signatureExpirationLedger(),
        contractId, functionName, from, to, amount,
    });
}

/** min(timeoutMs ?? 5000, maxTimeoutSeconds * 1000 / 2): a slow engine must not eat the payment window. */
export function effectiveTimeoutMs(policy: X402PolicyHook, maxTimeoutSeconds?: number): number {
    const base = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (typeof maxTimeoutSeconds === 'number' && Number.isFinite(maxTimeoutSeconds) && maxTimeoutSeconds > 0) {
        return Math.max(1, Math.min(base, Math.floor((maxTimeoutSeconds * 1000) / 2)));
    }
    return base;
}

/**
 * Wraps a signer so it only signs with a current ALLOW bound to this auth
 * entry. Anything else ends without a signature.
 *
 * `getCall` supplies the per-call context (URL, method, requirements): one
 * gated signer is created per x402Fetch, so two concurrent payments never
 * share state. `onRefused` receives the error before it is thrown, because
 * @x402/fetch re-wraps errors and loses their class.
 *
 * Not a security boundary against code in the same process: anyone holding
 * the base signer can still call it directly.
 */
export function createPolicyGatedSigner(
    base: X402BaseSigner,
    policy: X402PolicyHook,
    getCall: () => { url: string; method: string; requirements?: X402PaymentRequirementsView },
    onRefused?: (error: X402PolicyError) => void,
): X402BaseSigner {
    // La identidad se fija aquí. Si el signer base cambia de dirección a mitad
    // del pago, no se firma: lo evaluado se evaluó para esta cuenta.
    const account = base.address;
    const now = policy.now ?? Date.now;
    const report = (r: X402PolicyRecord) => {
        try { policy.onDecision?.(r); } catch { /* un observador no decide nada */ }
    };
    const refuse = (
        outcome: Exclude<X402PolicyOutcome, 'SIGNED'>, msg: string,
        context?: X402PolicyContext, decision?: X402PolicyDecision,
    ): never => {
        report({ outcome, context, decision, error: msg });
        const err = new X402PolicyError(outcome, msg, { decision, contextHash: context?.contextHash });
        try { onRefused?.(err); } catch { /* idem */ }
        throw err;
    };

    const signAuthEntry: SignFn = async (preimageXdr, opts) => {
        const call = getCall();
        if (!call.requirements) refuse('CONTEXT_MISMATCH', 'no payment requirements bound to this signing call');
        if (base.address !== account) refuse('SIGNER_CHANGED', 'base signer address changed after the gate was created');
        if (opts?.address && opts.address !== account) refuse('CONTEXT_MISMATCH', 'asked to sign for a different address');

        let authorization: X402PolicyContext['authorization'];
        try {
            authorization = describeAuthorization(preimageXdr, call.requirements!, account);
        } catch (e: any) {
            return refuse(e instanceof X402PolicyError ? e.outcome : 'CONTEXT_MISMATCH', e?.message ?? String(e));
        }
        const contextHash = sha256hex(JSON.stringify({ v: 1, url: call.url, method: call.method, payloadHash: authorization.payloadHash }));
        // Congelado: el engine lee, no reescribe lo que se firma.
        const context: X402PolicyContext = Object.freeze({
            contextVersion: 1 as const, url: call.url, method: call.method,
            requirements: Object.freeze({ ...call.requirements! }),
            authorization,
            signer: account, contextHash,
        });

        const timeoutMs = effectiveTimeoutMs(policy, call.requirements!.maxTimeoutSeconds);
        const controller = new AbortController();
        // Un solo plazo para toda la fase previa a la firma (evaluate + currentVersion).
        const deadline = now() + timeoutMs;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const TIMED_OUT = Symbol('timeout');
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(TIMED_OUT); }, timeoutMs);
        });
        timeout.catch(() => { /* se consume aquí; cada race lo vuelve a observar */ });

        try {
            let decision: X402PolicyDecision;
            try {
                decision = await Promise.race([
                    Promise.resolve().then(() => policy.evaluate(context, { signal: controller.signal })),
                    timeout,
                ]);
            } catch (e: any) {
                if (e === TIMED_OUT) return refuse('TIMEOUT', `no decision within ${timeoutMs} ms`, context);
                return refuse('ENGINE_ERROR', e?.message ?? String(e), context);
            }

            // Todo lo que no sea un ALLOW bien formado cierra.
            if (!decision || typeof decision !== 'object') return refuse('MALFORMED', 'engine returned no decision object', context);
            if (decision.decision === 'DENY') return refuse('DENY', decision.reason ?? 'denied', context, decision);
            if (decision.decision === 'WAIT') return refuse('WAIT', decision.reason ?? 'wait', context, decision);
            if (decision.decision !== 'ALLOW') return refuse('MALFORMED', `unknown verdict ${String((decision as any).decision)}`, context, decision);
            // Se copian los campos antes de cualquier await: mutar el objeto del
            // engine después no extiende ni cambia esta decisión.
            const allow: X402PolicyDecision = Object.freeze({ ...decision });
            if (allow.contextHash !== contextHash) return refuse('UNBOUND', 'ALLOW is not bound to this authorization', context, allow);
            if (allow.expiresAt !== undefined
                && (typeof allow.expiresAt !== 'number' || !Number.isFinite(allow.expiresAt))) {
                return refuse('MALFORMED', 'expiresAt must be epoch milliseconds', context, allow);
            }
            if (allow.expiresAt === undefined && policy.requireExpiry) {
                return refuse('EXPIRED', 'ALLOW without expiresAt while requireExpiry is set', context, allow);
            }
            const checkClock = () => {
                const t = now();
                if (t >= deadline) refuse('TIMEOUT', 'decision arrived after the deadline', context, allow);
                if (allow.expiresAt !== undefined && t >= allow.expiresAt) refuse('EXPIRED', 'ALLOW expired before signing', context, allow);
            };
            checkClock();

            if (policy.currentVersion) {
                if (!nonempty(allow.policyVersion)) {
                    return refuse('MALFORMED', 'ALLOW has no policyVersion to check against currentVersion', context, allow);
                }
                let current: unknown;
                try {
                    current = await Promise.race([
                        Promise.resolve().then(() => policy.currentVersion!(context, { signal: controller.signal })),
                        timeout,
                    ]);
                } catch (e: any) {
                    if (e === TIMED_OUT) return refuse('TIMEOUT', `no current policy version within ${timeoutMs} ms`, context, allow);
                    return refuse('VERSION_UNAVAILABLE', `currentVersion failed (${e?.message ?? String(e)})`, context, allow);
                }
                if (!nonempty(current)) return refuse('VERSION_UNAVAILABLE', 'currentVersion returned no version', context, allow);
                if (current !== allow.policyVersion) {
                    return refuse('STALE', `ALLOW was issued under policy ${allow.policyVersion}, current is ${current}`, context, allow);
                }
                // El reloj se vuelve a leer después del await.
                checkClock();
            }

            // Último chequeo antes de firmar, sin ningún await en medio.
            if (base.address !== account) return refuse('SIGNER_CHANGED', 'base signer address changed while the policy was evaluated', context, allow);
            report({ outcome: 'SIGNED', context, decision: allow });
            // Los bytes del parámetro original, no una copia que alguien pudo tocar.
            return base.signAuthEntry(preimageXdr, opts);
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    return { address: account, signAuthEntry };
}
