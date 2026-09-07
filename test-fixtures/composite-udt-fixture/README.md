# composite-udt-fixture — Kuyfi D1 verification fixture

**Purpose**: this is a test-only Soroban contract, deliberately minimal, deployed
exclusively to Stellar **Testnet** to give Kuyfi's Chaos Monkey a real,
externally-deployed target that exposes every composite type category its
UDT registry and type-aware fuzzer need to verify: struct, enum (plain
C-like discriminant), union (Rust-style enum-with-payload), nested UDT,
`Vec<UDT>`, and `Option<UDT>`. It is not a product, not mainnet, and not
part of the Kuyfi TUI itself — see `../../source/modules/chaos_monkey/` for
the actual scanner/fuzzer this fixture verifies.

Every function just validates the shape of its input and echoes it back (or
a small derived value) — there is no business logic here worth auditing.

## Deployment

- Network: **Testnet only**
- Toolchain: `stellar` CLI 25.2.0, `soroban-sdk = "25"` (resolved to 25.3.2),
  Rust 1.94.0, target `wasm32v1-none`
- Deploy account: existing local test identity `alexotico` (Testnet only)
- Contract ID: `CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ`
- Wasm hash: `fc434c25f0061597d95cc298f4c7031b374df7c6cf1387e29f8fe6b166a3d1c3`
- Upload tx: `3e4ca25112d329d6b9006fbdb1b5222cf4948722fffe429cb77308abe6464ce0`
- Deploy (create-contract) tx: `d9acea455d51c4525644934cca0310024a860f5b55e90dddeeb92e09a3bb03a6`

Rebuild and redeploy (from this directory):

```bash
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/composite_udt_fixture.wasm \
  --source alexotico \
  --network testnet \
  --alias composite_udt_fixture
```

## Composite type mapping (verified against soroban-sdk 25.3.2)

| Kuyfi concept | Rust shape | contractspecv0 entry | Wire ScVal |
|---|---|---|---|
| struct | `#[contracttype] struct Point { x: i128, y: i128 }` | `ScSpecEntryUdtStructV0` | `ScVal::Map`, sorted by field name |
| enum | `#[contracttype] enum Status { Active = 1, ... }` | `ScSpecEntryUdtEnumV0` | `ScVal::U32(discriminant)` |
| union | `#[contracttype] enum Action { Noop, SetValue(u32), Move(Point, Point) }` | `ScSpecEntryUdtUnionV0` (Void/Tuple cases) | `ScVal::Vec([Symbol(case), ...payload])` |
| nested UDT | `Wrapper { status: Status, anchor: Point }`, `Action::Move(Point, Point)` | nested `ScSpecTypeUdt` references | nested `ScVal` per the rules above |
| `Vec<UDT>` | `echo_points(pts: Vec<Point>)` | `ScSpecTypeVec` of `ScSpecTypeUdt` | `ScVal::Vec` of the element's `ScVal` |
| `Option<UDT>` | `echo_maybe_point(p: Option<Point>)` | `ScSpecTypeOption` of `ScSpecTypeUdt` | `ScVal::Void` (None) or the inner `ScVal` (Some) |

Nothing here was invented — every mapping was verified against the installed
`@stellar/stellar-sdk` (14.6.1) XDR type definitions before implementation,
and every row above was independently confirmed by decoding this contract's
own real `contractspecv0` section with Kuyfi's scanner and by round-tripping
a real invocation for each row (see the D1 acceptance report).
