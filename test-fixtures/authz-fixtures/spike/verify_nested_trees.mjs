// Offline (no network): shows that NA-1/NA-2/NA-3 sign the intended trees and that the
// signed payloads differ. Uses the same nestedTree() and ed25519Entry() as nested.mjs.
import {Keypair, scValToNative, xdr} from '@stellar/stellar-sdk';
import {StrKey} from '@stellar/stellar-sdk';
import {ed25519Entry, nestedTree, preimageHash} from './harness.mjs';

const router = StrKey.encodeContract(Buffer.alloc(32, 1));
const executor = StrKey.encodeContract(Buffer.alloc(32, 2));
const actor = Keypair.random();
const A = actor.publicKey();
const describe = inv => {
	const f = inv.function().contractFn();
	return {fn: f.functionName().toString(), contract: StrKey.encodeContract(f.contractAddress().contractId()) === router ? 'router' : 'executor', args: f.args().map(a => scValToNative(a)).map(v => (typeof v === 'string' && v === A ? 'ACTOR' : v)), children: inv.subInvocations().map(describe)};
};
const cases = {'NA-1': [5, 5, true], 'NA-2': [5, 5, false], 'NA-3': [5, 6, true]};
const out = {};
const payloads = {};
for (const [id, [amount, inner, withInner]] of Object.entries(cases)) {
	const tree = nestedTree(router, executor, A, amount, inner, withInner);
	const nonce = xdr.Int64.fromString('42');
	const entry = ed25519Entry({signer: actor, address: A, invocation: tree, expiration: 1000, nonce});
	out[id] = describe(entry.rootInvocation());
	payloads[id] = preimageHash(nonce, 1000, tree).toString('hex');
}
const checks = {
	'NA-1 root forward(5) with child execute(5)': out['NA-1'].children.length === 1 && out['NA-1'].children[0].args[1] === 5 && out['NA-1'].args[1] === 5,
	'NA-2 has NO child node': out['NA-2'].children.length === 0 && out['NA-2'].args[1] === 5,
	'NA-3 child signed for 6 while root is 5': out['NA-3'].children.length === 1 && out['NA-3'].children[0].args[1] === 6 && out['NA-3'].args[1] === 5,
	'payload hashes pairwise different (same nonce/expiry)': new Set(Object.values(payloads)).size === 3,
};
console.log(JSON.stringify({trees: out, payloads, checks}, null, 1));
if (!Object.values(checks).every(Boolean)) process.exit(1);
