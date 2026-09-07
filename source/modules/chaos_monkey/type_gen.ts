import {Address, Keypair, xdr} from '@stellar/stellar-sdk';
import type {
	UdtDef,
	UdtEnumDef,
	UdtField,
	UdtRegistry,
	UdtStructDef,
	UdtUnionDef,
} from './udt_registry.js';

export type {UdtRegistry, UdtField, UdtDef} from './udt_registry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;

/**
 * Depth/cycle guard for recursive UDT resolution (struct field is itself a
 * struct/union, Vec<UDT>, Option<UDT>, etc.). MAX_DEPTH bounds plain deep
 * nesting; `stack` catches a UDT that (directly or indirectly) contains
 * itself. Either condition makes a type "unresolved" rather than looping
 * forever or fabricating a value.
 */
const MAX_UDT_DEPTH = 4;

interface ResolveCtx {
	depth: number;
	stack: Set<string>;
}

function freshCtx(): ResolveCtx {
	return {depth: 0, stack: new Set()};
}

export function typeName(t: AnyTypeDef): string {
	const n: string = t.switch().name;
	switch (n) {
		case 'scSpecTypeOption':
			return `Option<${typeName(t.option().valueType())}>`;
		case 'scSpecTypeResult':
			return `Result<${typeName(t.result().okType())}, ${typeName(
				t.result().errorType(),
			)}>`;
		case 'scSpecTypeVec':
			return `Vec<${typeName(t.vec().elementType())}>`;
		case 'scSpecTypeMap':
			return `Map<${typeName(t.map().keyType())}, ${typeName(
				t.map().valueType(),
			)}>`;
		case 'scSpecTypeTuple':
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			return `(${(t.tuple().valueTypes() as AnyTypeDef[])
				.map(typeName)
				.join(', ')})`;
		case 'scSpecTypeBytesN':
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			return `BytesN<${t.bytesN().n() as number}>`;
		case 'scSpecTypeUdt':
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			return (t.udt().name() as Buffer).toString('utf-8');
		default:
			return n.replace(/^scSpecType/, '');
	}
}

function udtNameOf(t: AnyTypeDef): string {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-call
	return (t.udt().name() as Buffer).toString('utf-8');
}

/**
 * Resolves a UDT definition from the registry, applying the depth/cycle
 * guard. Returns null when the UDT is unknown, or when resolving it would
 * exceed MAX_UDT_DEPTH or re-enter a UDT already being expanded (a cycle).
 * Null must be treated as "cannot safely construct a value for this type" —
 * never silently substituted with a placeholder ScVal.
 */
function resolveUdt(
	udtName: string,
	registry: UdtRegistry,
	ctx: ResolveCtx,
): UdtDef | null {
	const def = registry.get(udtName);
	if (!def) return null;
	if (ctx.depth >= MAX_UDT_DEPTH) return null;
	if (ctx.stack.has(udtName)) return null;
	return def;
}

function childCtx(udtName: string, ctx: ResolveCtx): ResolveCtx {
	return {depth: ctx.depth + 1, stack: new Set(ctx.stack).add(udtName)};
}

/**
 * Builds a baseline (safe, type-correct, all-zeros-ish) ScVal for a given
 * type, or null if the type cannot be safely resolved (unknown/unregistered
 * UDT, or a depth/cycle limit hit while expanding a nested UDT). A null
 * baseline must cause the caller to skip the whole value/param/function it
 * belongs to — it must never be papered over with a placeholder ScVal, since
 * that would let a contract's rejection of a fabricated value be
 * misread as a security finding about a real input shape.
 */
export function baseline(
	t: AnyTypeDef,
	registry: UdtRegistry = new Map(),
	ctx: ResolveCtx = freshCtx(),
): xdr.ScVal | null {
	const n: string = t.switch().name;
	switch (n) {
		case 'scSpecTypeU32':
			return xdr.ScVal.scvU32(0);
		case 'scSpecTypeI32':
			return xdr.ScVal.scvI32(0);
		case 'scSpecTypeU64':
			return xdr.ScVal.scvU64(xdr.Uint64.fromString('0'));
		case 'scSpecTypeI64':
			return xdr.ScVal.scvI64(xdr.Int64.fromString('0'));
		case 'scSpecTypeTimepoint':
			return xdr.ScVal.scvTimepoint(xdr.Uint64.fromString('0'));
		case 'scSpecTypeDuration':
			return xdr.ScVal.scvDuration(xdr.Uint64.fromString('0'));
		case 'scSpecTypeU128':
			return xdr.ScVal.scvU128(
				new xdr.UInt128Parts({
					hi: xdr.Uint64.fromString('0'),
					lo: xdr.Uint64.fromString('0'),
				}),
			);
		case 'scSpecTypeI128':
			return xdr.ScVal.scvI128(
				new xdr.Int128Parts({
					hi: xdr.Int64.fromString('0'),
					lo: xdr.Uint64.fromString('0'),
				}),
			);
		case 'scSpecTypeU256':
			return xdr.ScVal.scvU256(
				new xdr.UInt256Parts({
					hiHi: xdr.Uint64.fromString('0'),
					hiLo: xdr.Uint64.fromString('0'),
					loHi: xdr.Uint64.fromString('0'),
					loLo: xdr.Uint64.fromString('0'),
				}),
			);
		case 'scSpecTypeI256':
			return xdr.ScVal.scvI256(
				new xdr.Int256Parts({
					hiHi: xdr.Int64.fromString('0'),
					hiLo: xdr.Uint64.fromString('0'),
					loHi: xdr.Uint64.fromString('0'),
					loLo: xdr.Uint64.fromString('0'),
				}),
			);
		case 'scSpecTypeAddress':
			return new Address(Keypair.random().publicKey()).toScVal();
		case 'scSpecTypeBool':
			return xdr.ScVal.scvBool(false);
		case 'scSpecTypeSymbol':
			return xdr.ScVal.scvSymbol('');
		case 'scSpecTypeString':
			return xdr.ScVal.scvString(Buffer.from(''));
		case 'scSpecTypeBytes':
			return xdr.ScVal.scvBytes(Buffer.from(''));
		case 'scSpecTypeBytesN':
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			return xdr.ScVal.scvBytes(Buffer.alloc(t.bytesN().n() as number));
		case 'scSpecTypeVec': {
			const elem = baseline(t.vec().elementType(), registry, ctx);
			return elem === null ? null : xdr.ScVal.scvVec([elem]);
		}

		case 'scSpecTypeMap':
			return xdr.ScVal.scvMap([]);
		case 'scSpecTypeOption':
			// None is always a valid representation of Option<T>, regardless of
			// whether T itself is resolvable — no need to expand it here.
			return xdr.ScVal.scvVoid();
		case 'scSpecTypeVoid':
			return xdr.ScVal.scvVoid();
		case 'scSpecTypeUdt': {
			const udtName = udtNameOf(t);
			const def = resolveUdt(udtName, registry, ctx);
			if (!def) return null;
			return baselineUdt(def, registry, childCtx(udtName, ctx));
		}

		// Result, Tuple — layout not derivable without full schema
		default:
			return null;
	}
}

function baselineUdt(
	def: UdtDef,
	registry: UdtRegistry,
	ctx: ResolveCtx,
): xdr.ScVal | null {
	switch (def.kind) {
		case 'struct':
			return buildStructScVal(def.fields, registry, ctx);
		case 'enum':
			return baselineEnum(def);
		case 'union':
			return baselineUnion(def, registry, ctx);
	}
}

function baselineEnum(def: UdtEnumDef): xdr.ScVal | null {
	const first = def.cases[0];
	if (!first) return null; // enum declared with zero cases — nothing valid to send
	return xdr.ScVal.scvU32(first.value);
}

function baselineUnion(
	def: UdtUnionDef,
	registry: UdtRegistry,
	ctx: ResolveCtx,
): xdr.ScVal | null {
	const first = def.cases[0];
	if (!first) return null; // union declared with zero cases
	return buildUnionScVal(first, registry, ctx);
}

/** Builds `Vec![Symbol(caseName), ...payload]` — the real Soroban wire shape
 * for a Rust-style enum-with-data (`#[contracttype] enum X { A, B(u32) }`),
 * as opposed to a plain C-like enum (ScSpecEntryUdtEnumV0), which is a bare
 * U32 discriminant instead. Returns null if any payload slot is unresolvable. */
function buildUnionScVal(
	unionCase: {name: string; valueTypes: AnyTypeDef[]},
	registry: UdtRegistry,
	ctx: ResolveCtx,
): xdr.ScVal | null {
	const payload: xdr.ScVal[] = [];
	for (const t of unionCase.valueTypes) {
		const v = baseline(t, registry, ctx);
		if (v === null) return null;
		payload.push(v);
	}

	return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(unionCase.name), ...payload]);
}

/**
 * Constructs a ScVal::Map representing a Soroban struct.
 * Entries are sorted lexicographically by field name, as Soroban requires.
 * Returns null if any field is unresolvable — a struct is only ever sent as
 * a whole, so a single unresolvable field means the whole struct is unsafe
 * to construct.
 */
function buildStructScVal(
	fields: UdtField[],
	registry: UdtRegistry,
	ctx: ResolveCtx,
): xdr.ScVal | null {
	const sorted = [...fields].sort((a, b) => a.name.localeCompare(b.name));
	const entries: xdr.ScMapEntry[] = [];
	for (const f of sorted) {
		const v = baseline(f.type, registry, ctx);
		if (v === null) return null;
		entries.push(
			new xdr.ScMapEntry({
				key: xdr.ScVal.scvSymbol(f.name),
				val: v,
			}),
		);
	}

	return xdr.ScVal.scvMap(entries);
}

export interface AttackVector {
	name: string;
	val: xdr.ScVal;
}

/**
 * Generates type-correct attack ScVals for a given parameter type.
 * For Vec<UDT>, uses real struct instances (via registry) instead of Void elements.
 * Vec vectors are kept small (empty + one-element) to avoid oversized transactions.
 * An unresolvable type (unknown UDT, depth/cycle limit) safely yields fewer
 * vectors rather than a fabricated ScVal — never an empty/placeholder value
 * standing in for a real one.
 */
export function attackVals(
	t: AnyTypeDef,
	registry: UdtRegistry = new Map(),
	ctx: ResolveCtx = freshCtx(),
): AttackVector[] {
	const n: string = t.switch().name;
	switch (n) {
		case 'scSpecTypeU32':
			return [
				{name: 'ZERO', val: xdr.ScVal.scvU32(0)},
				{name: 'ONE', val: xdr.ScVal.scvU32(1)},
				{name: 'MAX_U32', val: xdr.ScVal.scvU32(4_294_967_295)},
			];
		case 'scSpecTypeI32':
			return [
				{name: 'ZERO', val: xdr.ScVal.scvI32(0)},
				{name: 'NEG_ONE', val: xdr.ScVal.scvI32(-1)},
				{name: 'MAX_I32', val: xdr.ScVal.scvI32(2_147_483_647)},
				{name: 'MIN_I32', val: xdr.ScVal.scvI32(-2_147_483_648)},
			];
		case 'scSpecTypeU64':
			return [
				{name: 'ZERO', val: xdr.ScVal.scvU64(xdr.Uint64.fromString('0'))},
				{name: 'ONE', val: xdr.ScVal.scvU64(xdr.Uint64.fromString('1'))},
				{
					name: 'MAX_U64',
					val: xdr.ScVal.scvU64(xdr.Uint64.fromString('18446744073709551615')),
				},
			];
		case 'scSpecTypeI64':
			return [
				{name: 'ZERO', val: xdr.ScVal.scvI64(xdr.Int64.fromString('0'))},
				{name: 'NEG_ONE', val: xdr.ScVal.scvI64(xdr.Int64.fromString('-1'))},
				{
					name: 'MAX_I64',
					val: xdr.ScVal.scvI64(xdr.Int64.fromString('9223372036854775807')),
				},
				{
					name: 'MIN_I64',
					val: xdr.ScVal.scvI64(xdr.Int64.fromString('-9223372036854775808')),
				},
			];
		case 'scSpecTypeU128':
			return [
				{
					name: 'ZERO',
					val: xdr.ScVal.scvU128(
						new xdr.UInt128Parts({
							hi: xdr.Uint64.fromString('0'),
							lo: xdr.Uint64.fromString('0'),
						}),
					),
				},
				{
					name: 'ONE',
					val: xdr.ScVal.scvU128(
						new xdr.UInt128Parts({
							hi: xdr.Uint64.fromString('0'),
							lo: xdr.Uint64.fromString('1'),
						}),
					),
				},
				{
					name: 'MAX_U128',
					val: xdr.ScVal.scvU128(
						new xdr.UInt128Parts({
							hi: xdr.Uint64.fromString('18446744073709551615'),
							lo: xdr.Uint64.fromString('18446744073709551615'),
						}),
					),
				},
			];
		case 'scSpecTypeI128':
			return [
				{
					name: 'ZERO',
					val: xdr.ScVal.scvI128(
						new xdr.Int128Parts({
							hi: xdr.Int64.fromString('0'),
							lo: xdr.Uint64.fromString('0'),
						}),
					),
				},
				{
					name: 'ONE',
					val: xdr.ScVal.scvI128(
						new xdr.Int128Parts({
							hi: xdr.Int64.fromString('0'),
							lo: xdr.Uint64.fromString('1'),
						}),
					),
				},
				{
					name: 'NEG_ONE',
					val: xdr.ScVal.scvI128(
						new xdr.Int128Parts({
							hi: xdr.Int64.fromString('-1'),
							lo: xdr.Uint64.fromString('18446744073709551615'),
						}),
					),
				},
				{
					name: 'MAX_I128',
					val: xdr.ScVal.scvI128(
						new xdr.Int128Parts({
							hi: xdr.Int64.fromString('9223372036854775807'),
							lo: xdr.Uint64.fromString('18446744073709551615'),
						}),
					),
				},
				{
					name: 'MIN_I128',
					val: xdr.ScVal.scvI128(
						new xdr.Int128Parts({
							hi: xdr.Int64.fromString('-9223372036854775808'),
							lo: xdr.Uint64.fromString('0'),
						}),
					),
				},
			];
		case 'scSpecTypeAddress':
			return [
				{
					name: 'RANDOM_ADDR_A',
					val: new Address(Keypair.random().publicKey()).toScVal(),
				},
				{
					name: 'RANDOM_ADDR_B',
					val: new Address(Keypair.random().publicKey()).toScVal(),
				},
			];
		case 'scSpecTypeBool':
			return [
				{name: 'TRUE', val: xdr.ScVal.scvBool(true)},
				{name: 'FALSE', val: xdr.ScVal.scvBool(false)},
			];
		case 'scSpecTypeSymbol':
			return [
				{name: 'EMPTY_SYMBOL', val: xdr.ScVal.scvSymbol('')},
				{name: 'LONG_SYMBOL', val: xdr.ScVal.scvSymbol('a'.repeat(32))},
				{name: 'OVERSIZE_SYMBOL', val: xdr.ScVal.scvSymbol('a'.repeat(64))},
			];
		case 'scSpecTypeString':
			return [
				{name: 'EMPTY_STR', val: xdr.ScVal.scvString(Buffer.from(''))},
				{
					name: 'LONG_STR',
					val: xdr.ScVal.scvString(Buffer.from('a'.repeat(256))),
				},
			];
		case 'scSpecTypeBytes':
			return [
				{name: 'EMPTY_BYTES', val: xdr.ScVal.scvBytes(Buffer.from(''))},
				{name: 'LARGE_BYTES', val: xdr.ScVal.scvBytes(Buffer.alloc(256))},
			];
		case 'scSpecTypeBytesN': {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			const byteLen = t.bytesN().n() as number;
			return [
				{name: 'ZERO_BYTES_N', val: xdr.ScVal.scvBytes(Buffer.alloc(byteLen))},
				{
					name: 'FF_BYTES_N',
					val: xdr.ScVal.scvBytes(Buffer.alloc(byteLen, 0xff)),
				},
			];
		}

		case 'scSpecTypeVec': {
			const elemType = t.vec().elementType();
			const elemBase = baseline(elemType, registry, ctx);
			const vectors: AttackVector[] = [
				{name: 'EMPTY_VEC', val: xdr.ScVal.scvVec([])},
			];
			// ONE_ELEM/TWO_ELEM use a real struct/union/enum instance (or
			// primitive baseline) via registry — skipped entirely (not
			// fabricated as an empty/void element) when the element type can't
			// be safely resolved.
			if (elemBase !== null) {
				vectors.push(
					{name: 'ONE_ELEM_VEC', val: xdr.ScVal.scvVec([elemBase])},
					{name: 'TWO_ELEM_VEC', val: xdr.ScVal.scvVec([elemBase, elemBase])},
				);
			}

			return vectors;
		}

		case 'scSpecTypeOption': {
			const some = baseline(t.option().valueType(), registry, ctx);
			const vectors: AttackVector[] = [
				{name: 'NONE', val: xdr.ScVal.scvVoid()},
			];
			if (some !== null) vectors.push({name: 'SOME_BASELINE', val: some});
			return vectors;
		}

		case 'scSpecTypeTimepoint':
			return [
				{
					name: 'ZERO_TS',
					val: xdr.ScVal.scvTimepoint(xdr.Uint64.fromString('0')),
				},
				{
					name: 'MAX_TS',
					val: xdr.ScVal.scvTimepoint(
						xdr.Uint64.fromString('18446744073709551615'),
					),
				},
			];
		case 'scSpecTypeDuration':
			return [
				{
					name: 'ZERO_DUR',
					val: xdr.ScVal.scvDuration(xdr.Uint64.fromString('0')),
				},
				{
					name: 'MAX_DUR',
					val: xdr.ScVal.scvDuration(
						xdr.Uint64.fromString('18446744073709551615'),
					),
				},
			];
		case 'scSpecTypeUdt': {
			const udtName = udtNameOf(t);
			const def = resolveUdt(udtName, registry, ctx);
			if (!def) return []; // unknown/unresolvable UDT — safely skip, no fabricated ScVal
			return attackValsForUdt(def, registry, childCtx(udtName, ctx));
		}

		// Result, Tuple — layout not derivable without full schema
		default:
			return [];
	}
}

function attackValsForUdt(
	def: UdtDef,
	registry: UdtRegistry,
	ctx: ResolveCtx,
): AttackVector[] {
	switch (def.kind) {
		case 'struct':
			return structFieldAttackVectors(def, registry, ctx);
		case 'enum':
			return enumCaseAttackVectors(def);
		case 'union':
			return unionAttackVectors(def, registry, ctx);
	}
}

/**
 * One-variable-at-a-time struct field fuzzing: the struct's own baseline is
 * built once, then each field is attacked in turn while all other fields
 * stay at baseline — mirroring the top-level OAT strategy fuzzer_math.ts
 * already uses for plain function parameters. Bounded by field count *
 * per-field attack count — no combinatorial explosion. Returns [] (not a
 * fabricated struct) if the struct's own baseline can't be built at all.
 */
function structFieldAttackVectors(
	def: UdtStructDef,
	registry: UdtRegistry,
	ctx: ResolveCtx,
): AttackVector[] {
	const struct = buildStructScVal(def.fields, registry, ctx);
	if (struct === null) return [];

	const sorted = [...def.fields].sort((a, b) => a.name.localeCompare(b.name));
	const vectors: AttackVector[] = [];

	for (let i = 0; i < sorted.length; i++) {
		const field = sorted[i]!;
		const fieldAttacks = attackVals(field.type, registry, ctx);

		for (const attack of fieldAttacks) {
			const entries = sorted.map((f, j) =>
				j === i
					? new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol(f.name),
							val: attack.val,
					  })
					: new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol(f.name),
							val: baseline(f.type, registry, ctx)!,
					  }),
			);
			vectors.push({
				name: `${def.name}.${field.name}::${attack.name}`,
				val: xdr.ScVal.scvMap(entries),
			});
		}
	}

	return vectors;
}

/**
 * One vector per real declared enum case (never a fabricated/out-of-range
 * discriminant — that would only prove the host decoder rejects garbage,
 * not exercise the contract's own logic).
 */
function enumCaseAttackVectors(def: UdtEnumDef): AttackVector[] {
	return def.cases.map(c => ({
		name: `${def.name}::${c.name}`,
		val: xdr.ScVal.scvU32(c.value),
	}));
}

/**
 * For each real declared union case: one "case selection" vector (baseline
 * payload, if any), plus one-variable-at-a-time attacks over that case's own
 * payload slots — discriminant and payload always stay coherent (a payload
 * attack value is only ever placed inside its own case's Vec, never mixed
 * across cases). Bounded by case count * payload-slot count * per-slot
 * attack count.
 */
function unionAttackVectors(
	def: UdtUnionDef,
	registry: UdtRegistry,
	ctx: ResolveCtx,
): AttackVector[] {
	const vectors: AttackVector[] = [];

	for (const unionCase of def.cases) {
		const caseBaseline = buildUnionScVal(unionCase, registry, ctx);
		if (caseBaseline === null) continue; // this case's payload isn't resolvable — skip it, not fabricate it

		vectors.push({name: `${def.name}::${unionCase.name}`, val: caseBaseline});

		for (let i = 0; i < unionCase.valueTypes.length; i++) {
			const slotAttacks = attackVals(unionCase.valueTypes[i], registry, ctx);
			for (const attack of slotAttacks) {
				const payload = unionCase.valueTypes.map((slotType, j) =>
					j === i ? attack.val : baseline(slotType, registry, ctx)!,
				);
				vectors.push({
					name: `${def.name}::${unionCase.name}.${i}::${attack.name}`,
					val: xdr.ScVal.scvVec([
						xdr.ScVal.scvSymbol(unionCase.name),
						...payload,
					]),
				});
			}
		}
	}

	return vectors;
}
