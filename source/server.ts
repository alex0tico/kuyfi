#!/usr/bin/env node
import {createScanServer} from './modules/scan_server.js';
import type {PaymentNetwork} from './modules/scan_server.js';

const payTo = process.env['PAY_TO'];

if (!payTo) {
	console.error(
		'PAY_TO is required: the public Stellar address (G…) that receives payments. See .env.example',
	);
	process.exit(1);
}

const network = (process.env['NETWORK'] ?? 'stellar:testnet') as PaymentNetwork;
const port = Number(process.env['PORT'] ?? 4021);

createScanServer({
	payTo,
	price: process.env['PRICE'] ?? '500 CLP',
	network,
	facilitatorUrl:
		process.env['FACILITATOR_URL'] ??
		(network === 'stellar:pubnet'
			? 'https://local402-mainnet.vercel.app/facilitator'
			: 'https://local402.vercel.app/facilitator'),
}).listen(port, () => {
	console.log(`kuyfi-server: GET http://localhost:${port}/scan/<CONTRACT_ID>`);
});
