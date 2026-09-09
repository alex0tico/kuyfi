/**
 * Single source of truth for the RPC endpoint Kuyfi talks to. Testnet only —
 * this sprint has no mainnet support and no network selector; see
 * ARCHITECTURE.md's "Security notes". Previously this literal was declared
 * separately in app.tsx, chaos_monkey/index.ts, and chaos_monkey/keypair_factory.ts.
 */
export const TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org';
