---
title: "Attack vectors reference"
description: "Complete Chaos Monkey vector catalog."
slug: "vectors"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Attack vectors reference

## Math / boundary (`fuzzer_math.ts` + `type_gen.ts`)

OAT mutations. Unsigned: no `NEG_ONE`/`MIN_*`. Symbol: `LONG_SYMBOL`(32) `OVERSIZE_SYMBOL`(64). String `LONG_STR`=256. Bytes `LARGE_BYTES`=256. `MAX_UDT_DEPTH=4`. Names like `amount::MAX_I128`.

## Authorization (`fuzzer_access.ts`)

| Vector | Targets |
|--------|---------|
| `UNAUTHORIZED_CALL` | Admin-pattern substrings |
| `REINIT_ATTACK` | initialize / init / setup |
| `SELF_CALL_ATTACK` | **exact** `set_admin` | `set_pending_admin` | `transfer_admin` |
| `UNAUTHORIZED_ADDR_CALL` | Non-admin + Address param |

Admin substrings: pause, unpause, initialize, init, setup, upgrade, set_admin, set_pending_admin, transfer_admin, emergency.

Only this family sets `expectedToFail=true`.

## Call ordering (`fuzzer_call_order.ts`)

Once per session. ≤1 fn per group; no reuse across groups.

| Group | Patterns |
|-------|----------|
| `REINIT_SEQUENCE` | initialize, init, setup |
| `REPEATED_WITHDRAW_SEQUENCE` | withdraw, remove |
| `REPEATED_CLAIM_SEQUENCE` | `claim` only (no harvest) |

## Fee / BPS (`fuzzer_fee.ts`)

Param name `/fee|fees|bps|basis_point/i` + numeric types.
Labels: `BPS_0|1|9999|10000|10001` + `MAX_<TYPE>`.

## Liquidity (`fuzzer_liquidity.ts`)

Fn name `/liquidity|swap|reserve/i`; first two numeric params.
Labels: `ZERO_A_MAX_B`, `MAX_A_ZERO_B`, `MAX_A_MAX_B`, `ONE_A_MAX_B`, `MAX_A_ONE_B`, `MIN_A_MAX_B` (signed A only).
Name: `LIQUIDITY::<paramA>x<paramB>::<pairLabel>`
