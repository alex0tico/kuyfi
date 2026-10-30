import {rpc} from '@stellar/stellar-sdk';
import {scanContract} from '../../dist/modules/scanner.js';
import {attackVals, typeName} from '../../dist/modules/chaos_monkey/type_gen.js';
const s = await scanContract(process.argv[2], new rpc.Server('https://soroban-testnet.stellar.org'));
let total = 0;
for (const f of s.functions) {
	const per = f.params.map(p => [p.name, typeName(p.type), attackVals(p.type, s.udtRegistry).length]);
	const n = per.reduce((a, x) => a + x[2], 0); total += n;
	console.log(f.name, JSON.stringify(per), 'math=', n);
}
console.log('math total', total, 'udts', [...s.udtRegistry.keys()]);
