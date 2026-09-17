# Demo — Step-by-Step Walkthrough

This guide shows a complete session: install → OSINT scan → Chaos Monkey → read the report.

You need a Stellar Testnet contract ID to follow along. Any deployed Testnet contract works. If you don't have one, search the [Stellar Testnet Explorer](https://testnet.steexp.com) for an active AMM or token contract.

---

## 1. Install

```bash
git clone https://github.com/alex0tico/kuyfi_tui.git
cd kuyfi_tui
npm ci
npm run build
```

Expected output from the last command: TypeScript compiler produces `dist/` with no errors.

---

## 2. Launch the terminal

```bash
npm start
```

The TUI opens with the main menu:

```
KUYFI v0.1 · SECURITY TERMINAL · Network: TESTNET · [ESC] Menu

  [1]  OSINT Scanner         Map contract attack surface
  [2]  Chaos Monkey          Fuzz & stress test a contract
  [3]  System Logs           RPC connection status
  [4]  About                 Project info

  ↑↓ navigate   Enter select   1–4 shortcut
```

---

## 3. Run the OSINT Scanner

Press `1` to open the Scanner. Enter your Contract ID (56 characters, starts with `C`) and press `Enter`.

Kuyfi fetches the WASM bytecode from `soroban-testnet.stellar.org` and decodes the contract spec. In a few seconds you see the attack surface map:

```
🛡 ATTACK SURFACE MAP ─── CABC...XYZ ─── 45,312 bytes

✔ Functions found: 7

  swap(amount_in: i128, min_amount_out: i128) → Has Return
  deposit(amount_a: i128, amount_b: i128) → Has Return
  withdraw(shares: i128) → Has Return
  initialize(token_a: Address, token_b: Address, fee: u32) → Void
  pause() → Void
  unpause() → Void
  get_reserves() → Has Return
```

No source code was needed. The scan is read-only — no transactions are submitted.

---

## 4. Launch Chaos Monkey

From the Scanner results screen, press `[C]` to load the same contract into Chaos Monkey.

Press `Enter` to start the fuzzing session. Kuyfi:

1. Generates an ephemeral Stellar keypair.
2. Funds it via Friendbot (Testnet only).
3. Runs math boundary and access control vectors against each function.
4. Streams live progress:

```
Generating ephemeral keypair...
Keypair funded: GBTEST1234...
Connected to RPC: https://soroban-testnet.stellar.org
Starting fuzzing session on 7 function(s)...
[swap] Running math vectors (2 params)...
[swap] Math done (8 invocations)
[initialize] Running math vectors (3 params)...
[initialize] Running access control vectors...
[initialize] Access done (2 invocations)
...
Building report...
Scan complete — 3 finding(s) | CRITICAL: 1 HIGH: 2
```

---

## 5. Read the report

After the session the terminal shows the findings report:

```
────────────────────────────────────────────────────────
  CHAOS MONKEY — SECURITY REPORT
────────────────────────────────────────────────────────
  Contract : CXXX...
  Scanned  : 2026-06-09T14:32:01.000Z
  Network  : TESTNET
  Functions: 7  |  Vectors run: 24
────────────────────────────────────────────────────────
  SUMMARY
    CRITICAL         : 1
    HIGH             : 2
    MEDIUM           : 0
    LOW              : 1
    PRECONDITION_FAIL: 1
    INFO             : 18
────────────────────────────────────────────────────────
  FINDINGS (3)

  [KYF-001] CRITICAL — POTENTIAL_VULN
  Function : initialize
  Vector   : UNAUTHORIZED_CALL
  Details  : access control bypass — call was NOT rejected on initialize

  [KYF-002] HIGH — POTENTIAL_VULN
  Function : swap
  Vector   : amount_in::MAX_VALUE_ATTACK
  Details  : WASM panic on type-correct input: ...

  [KYF-003] HIGH — UNEXPECTED_ERROR
  Function : deposit
  Vector   : amount_a::NEGATIVE_ATTACK
  Details  : Function reached storage operation before failure — verify auth...

────────────────────────────────────────────────────────
```

Press `[M]` to return to the menu, or `[S]` to scan another contract.

---

## Notes

- The fuzzer submits real transactions. Each vector costs a small XLM fee from the Friendbot-funded ephemeral account.
- The ephemeral keypair is discarded after the session. No keys are stored.
- `PRECONDITION_FAIL` findings (LOW) typically indicate the contract is working correctly but the fuzzer's ephemeral account lacked required token balance or protocol state — not a vulnerability.
- For a detailed explanation of every signal and severity level, see [`docs/chaos-monkey.md`](./chaos-monkey.md).
