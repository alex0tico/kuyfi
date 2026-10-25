// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;

export interface UdtField {
	name: string;
	type: AnyTypeDef; // xdr.ScSpecTypeDef
}

export interface UdtStructDef {
	kind: 'struct';
	name: string;
	fields: UdtField[];
}

export interface UdtUnionCase {
	name: string;
	/** Empty for a void case (no payload), e.g. `Variant`. Non-empty for a
	 * tuple case, e.g. `Variant(u32, Address)`. */
	valueTypes: AnyTypeDef[];
}

export interface UdtUnionDef {
	kind: 'union';
	name: string;
	cases: UdtUnionCase[];
}

export interface UdtEnumCase {
	name: string;
	/** The real u32 discriminant declared in the contract spec. */
	value: number;
}

export interface UdtEnumDef {
	kind: 'enum';
	name: string;
	cases: UdtEnumCase[];
}

export type UdtDef = UdtStructDef | UdtUnionDef | UdtEnumDef;

/**
 * Registry of UDT definitions keyed by name, covering all three composite
 * shapes Soroban's contractspecv0 can declare. One shared representation so
 * baseline()/attackVals() in type_gen.ts don't need three disconnected
 * lookup structures.
 */
export type UdtRegistry = Map<string, UdtDef>;

/**
 * Builds a UdtRegistry from a contractspecv0 entries[] array (the same
 * ScSpecEntry[] the scanner already decodes). Structs, unions, and enums are
 * all captured here.
 *
 * scSpecEntryUdtErrorEnumV0 (#[contracterror] enums, used only as a
 * function's Result::Err payload type, never as an input parameter shape we
 * construct fuzz values for) and scSpecEntryEventV0 are intentionally not
 * resolved into this registry — not value shapes this fuzzer sends as input.
 */
export function buildUdtRegistry(entries: AnyTypeDef[]): UdtRegistry {
	const registry: UdtRegistry = new Map();

	for (const e of entries) {
		const kind: string = e.switch().name;

		if (kind === 'scSpecEntryUdtStructV0') {
			const s = e.udtStructV0();
			const name = (s.name() as Buffer).toString('utf-8');
			const fields: UdtField[] = (s.fields() as AnyTypeDef[]).map(f => ({
				name: (f.name() as Buffer).toString('utf-8'),
				type: f.type(),
			}));
			registry.set(name, {kind: 'struct', name, fields});
		} else if (kind === 'scSpecEntryUdtUnionV0') {
			const u = e.udtUnionV0();
			const name = (u.name() as Buffer).toString('utf-8');
			const cases: UdtUnionCase[] = (u.cases() as AnyTypeDef[]).map(c => {
				const caseKind: string = c.switch().name;
				if (caseKind === 'scSpecUdtUnionCaseVoidV0') {
					const v = c.voidCase();
					return {name: (v.name() as Buffer).toString('utf-8'), valueTypes: []};
				}

				const t = c.tupleCase();
				return {
					name: (t.name() as Buffer).toString('utf-8'),
					valueTypes: t.type() as AnyTypeDef[],
				};
			});
			registry.set(name, {kind: 'union', name, cases});
		} else if (kind === 'scSpecEntryUdtEnumV0') {
			const en = e.udtEnumV0();
			const name = (en.name() as Buffer).toString('utf-8');
			const cases: UdtEnumCase[] = (en.cases() as AnyTypeDef[]).map(c => ({
				name: (c.name() as Buffer).toString('utf-8'),
				value: c.value() as number,
			}));
			registry.set(name, {kind: 'enum', name, cases});
		}
		// scSpecEntryFunctionV0 / scSpecEntryUdtErrorEnumV0 / scSpecEntryEventV0 — not a UDT value def, skip.
	}

	return registry;
}
