# Demo — Step-by-Step Walkthrough

This guide shows a complete session: build → OSINT scan → Chaos Monkey → read and export the report.

The examples use Kuyfi's own intentionally vulnerable Testnet test fixture, `CDYUQRWYE6INSGTMJWHPU32VSWVOZ456EUHJMMQXTCFXPFUXPH2JTPV7` (see [`docs/technical-writeup.md`](./technical-writeup.md)). Any deployed Testnet contract works, but only test contracts you own or are authorized to test. Output blocks below are excerpts.

---

## 1. Build from source

These steps run Kuyfi from a source checkout. For the global install (`npm install -g @kuyfi/kuyfi`), see the [README](../README.md#installation).

```bash
git clone https://github.com/alex0tico/kuyfi.git
cd kuyfi
npm ci
npm run build
```

Expected output from the last command: the TypeScript compiler produces `dist/` with no errors.

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

Press `1` to open the Scanner. Enter a Contract ID (56 characters, starts with `C`) and press `Enter`.

Kuyfi fetches the WASM bytecode from `soroban-testnet.stellar.org` and decodes the contract spec. In a few seconds you see the attack surface map:

```
🛡 ATTACK SURFACE MAP ─── CDYUQR...JTPV7 ─── 1,700 bytes

✔ Functions found: 3

get_value() → Has Return
set_admin_value(admin: Address, value: I128) → Void
secure_set_admin_value(admin: Address, value: I128) → Void
```

No source code was needed. The scan is read-only — no transactions are submitted.

---

## 4. Launch Chaos Monkey

From the Scanner results screen, press `[C]` to load the same contract into Chaos Monkey, then press `Enter` to start. Kuyfi:

1. Generates an ephemeral Stellar keypair and funds it via Friendbot (Testnet only).
2. Runs each vector family whose shape a function matches: math/boundary, access-control, fee/basis-point and liquidity-ratio, plus call-ordering once per session.
3. Simulates every vector first. Only vectors whose simulation succeeds are signed and broadcast to Testnet; a vector that fails simulation is classified from its diagnostics and nothing is sent.
4. Streams live progress:

```
Generating ephemeral keypair...
Keypair funded: GBO74AJRL2...
Connected to RPC: https://soroban-testnet.stellar.org
Starting fuzzing session on 3 function(s)...
[get_value] Running math vectors (0 params)...
[get_value] Math done (0 invocations)
[set_admin_value] Running math vectors (2 params)...
[set_admin_value] Math done (7 invocations)
[set_admin_value] Running access control vectors...
[set_admin_value] Access done (1 invocations)
...
Building report...
Scan complete — 1 finding(s) | CRITICAL: 1 HIGH: 0
```

---

## 5. Read the report

After the session the terminal shows the report. This excerpt is from the fixture run above:

```
────────────────────────────────────────────────────────
  CHAOS MONKEY — SECURITY REPORT
────────────────────────────────────────────────────────
  Functions: 3  |  Vectors run: 16
  ...
  EVIDENCE
    Broadcast transactions: 16
    Transactions with hash: 16
────────────────────────────────────────────────────────
  FINDINGS (1)

  [KYF-001] CRITICAL — POTENTIAL_VULN
  Function : set_admin_value
  Vector   : UNAUTHORIZED_CALL
  Details  : UNAUTHORIZED_CALL: access control bypass — call was NOT rejected on set_admin_value
  Tx       : 2414467c1788a311f2c9c4043b20443d43055462c9f592c053f556b130b173da

────────────────────────────────────────────────────────
```

`KYF-001` is a signal, not a verdict: an access-control vector that was expected to be rejected succeeded. In this fixture that is the deliberately missing `require_auth()`. The protected `secure_set_admin_value` produced no finding.

The summary counters cover every vector; the findings list contains only vectors that were not classified `SECURE` or `PRECONDITION_FAIL`. `Tx` appears only for findings whose transaction was broadcast. Many findings, notably `UNEXPECTED_ERROR` ones, have no transaction.

---

## 6. Export the report

On the report screen, press `[J]` for JSON, `[P]` for PDF, or `[B]` for both. Exports are written from the same run, so both files share one `reportId`. Press `[M]` to return to the menu or `[S]` to scan another contract.

Headless equivalent, with no TUI:

```bash
node dist/cli.js <CONTRACT_ID> --json --pdf
```

---

## Notes

- Vectors that pass simulation are real Testnet transactions; each costs a small XLM fee from the Friendbot-funded ephemeral account.
- The ephemeral keypair is discarded after the session. No keys are stored.
- `PRECONDITION_FAIL` and `SECURE` vectors are counted in the summary but are not listed as findings. `PRECONDITION_FAIL` typically means the test account lacked the signer, balance or state the call needs.
- Every finding is a lead to investigate. Zero findings does not prove a contract is secure.
- For every signal and severity, see [`docs/chaos-monkey.md`](./chaos-monkey.md).
