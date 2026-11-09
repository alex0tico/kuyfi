# Instawards 2 — Final acceptance record (D1, D2, D3)

Status date: 2026-11-09. Branch: `instawards-2-public` at `e852625`.

This document supersedes the status stated in [`D1-ACCEPTANCE.md`](D1-ACCEPTANCE.md) (2026-10-22/24), which listed D1 as not fully complete because of open items. It records, per deliverable and per criterion, what the evidence supports. Criteria come from the Instawards 2 application (acceptance text and "planned evidence of completion" for D1, D2 and D3).

**Status values.** `complete` = the written criterion is met and the evidence is cited. `partial` = part of the criterion is met; the gap is stated. Where the evidence is kept private (third-party contracts, fixture addresses), the row says so and the claim rests on the author's statement, not on anything a reader can verify in this repository.

**Privacy.** Third-party contracts are referred to only as Contract A, B and C. Their identifiers, WASM hashes, function names and transactions are kept locally by the author and are not published. The collaborators authorised testing and disclosure of results, not publication of recoverable identifiers.

## Summary

| Deliverable | Result |
|---|---|
| D1 — Contextual inputs and traceable campaigns | Complete except two parts: the manual audits on Contracts A/B/C have no public evidence, and the changes are on a public branch that is not merged into `main` |
| D2 — Authorization-aware test matrix | 12 of 12 cases supported by evidence; partial on external acceptance, public reproducibility of addresses and the recorded demo |
| D3 — Developer workflow and CI integration | Features, tests and the public CI example complete; partial on external campaigns (3 of 5) and on the participant build |

Open items across all three deliverables are listed at the end.

---

## D1 — Contextual inputs and traceable campaigns

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1.1 | Contextual configuration (roles, known values) | complete | `42876d6`; `source/modules/chaos_monkey/context_config.ts` and `context_config.test.ts`; examples in `test-fixtures/baseline-evidence/context-fixtures/configs/*.json` |
| 1.2 | Per-campaign limits (functions, vector families, maximum vectors, simulate-only or broadcast-allowed) | complete | `42876d6`; `source/modules/chaos_monkey/campaign.ts` and `campaign.test.ts`. The aggregate reports 0 transactions sent in all three real-contract campaigns |
| 1.3 | Provenance on 100% of generated inputs | complete | `42876d6`; `provenance.audit.percent = 100` in the scenario, control and campaign reports under `test-fixtures/baseline-evidence/` and in `real-contracts-aggregate/aggregate.json` |
| 1.4 | Scenarios S1 and S2 reach their defined observable in 3 of 3 runs with context on, with the difference documented | complete | `test-fixtures/baseline-evidence/context-fixtures/COMPARISON.md` and the run JSON beside it. Arms A (v0.1.0) and B (sprint build, context off) reach 0 events; arm C (context on) reaches 6 per run for S1 and 1 per run for S2, in 3 of 3 runs. Two fixtures of our own: an observation, not a measure of effectiveness. The HIGH findings on these fixtures are hypotheses |
| 1.5 | Vulnerable/protected control: finding on the vulnerable function, none on the protected one, 3 of 3 runs; regression fixed and re-tested | complete | `test-fixtures/baseline-evidence/control/` (3 of 3 on the sprint build); regression fix and re-run documented in `D1-ACCEPTANCE.md` row 5 |
| 1.6 | Campaigns on three distinct real Testnet contracts, separate from our fixtures | partial | Public evidence: simulate-only campaigns run 2026-10-22 on Contracts A, B and C, aggregated in `test-fixtures/baseline-evidence/real-contracts-aggregate/aggregate.json` (A: 64 vectors, 40 accepted, 24 blocked by a generic host trap, 0 supported findings; B: 32 vectors, all 32 rejected by the contract's own input validation; C: 69 vectors, 55 blocked, 14 accepted, 0 findings). Coverage was limited: no business logic was reached on Contract B. **Gap:** the author also ran manual audits and campaigns on the three contracts afterwards; the author reports them as done, but they have no publishable evidence and are not reflected in the aggregate |
| 1.7 | Authorization record per campaign (agreed functions, vector families, state-changing permission, limits); no record means simulate-only | complete (private) | Records `A-1`, `B-1`, `C-1` and the `authorizationRecord` in each local config and report; state-changing permission was not granted, so every campaign was simulate-only. The author states that the owner/contact, date window and contract versions exist; they are kept privately and cannot be checked from this repository. The earlier open item P1 in `D1-ACCEPTANCE.md` is closed on that basis |
| 1.8 | Explicit classification of each blocked vector before the semantic condition | complete | Build `8e6851c`; `provenance.invocations[].outcome` and `signal`; per-category counts in the aggregate |
| 1.9 | Planned evidence: merged changes | partial | The changes are published on `origin/instawards-2-public` (`e852625`) and are **not merged into `main`** (`git merge-base --is-ancestor` against `origin/main` fails) |
| 1.10 | Planned evidence: configuration examples, baseline and sprint JSON reports, comparison document | complete | `test-fixtures/baseline-evidence/` (configs, `run*.json`, `COMPARISON.md`) |
| 1.11 | Planned evidence: contract and fixture identifiers with WASM hashes; authorization records | complete (private for third parties) | Recorded locally for Contracts A/B/C and not published; fixture contracts are rebuilt from `test-fixtures/` sources |

Limits that still apply: a `SECURE` verdict in these reports means "accepted without failure or rejected with a trustworthy contract/authorization error", not "protected". No campaign proves security.

---

## D2 — Authorization-aware test matrix

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 2.1 | Build, sign and validate authorization entries in enforcing-mode simulation; relay account as transaction source, actor authorises only through explicit entries | complete | `kuyfi authz` (`source/modules/authz/`); commits `42876d6`, `4691452`, `aba05f9`, `18c68c0`; the separation of relay and actor, CSPRNG nonce, explicit `enforce` and send-blocking in simulate-only are covered by automated tests |
| 2.2 | Twelve cases: ED-1…5, CA-1…4, NA-1…3. Completion: 12 of 12 accepted | complete (evidence) | [`D2-FINAL-RUN.md`](D2-FINAL-RUN.md): definitive run of 2026-10-31 on a fresh deployment, product commit `18c68c0`, matrices hashed (SHA-256) before the first execution. Simulation 8/8, 5/5 and 4/4 accepted in 3 consecutive repetitions; all 12 cases `supported`; no failure record. Fixtures and matrix templates: `test-fixtures/authz-fixtures/` (commit `93af3f7`) |
| 2.3 | Executed is not accepted: attributable evidence and a paired control for each case | complete | Each case in `D2-FINAL-RUN.md` §3 has its control (ED-1, C-ED5, CA-1, CA-3, NA-1, C-NA3). Discrepancies found earlier were corrected and re-run: ED-4 boundary (`aba05f9`), NA-2/NA-3 distinct stage and message (`4691452`) |
| 2.4 | The four success cases also need on-chain evidence | complete | ED-1, CA-1, CA-3 and NA-1 included on Testnet, SUCCESS, with state read-back (ledgers 5493178, 5493181, 5493183, 5493187), `D2-FINAL-RUN.md` §3 |
| 2.5 | Day 7 review (enforcing simulation on Ed25519 and custom account), reported in writing | complete | [`D2-REVIEW-FRIDAY.md`](D2-REVIEW-FRIDAY.md), [`D2-SPIKE-WEEK1.md`](D2-SPIKE-WEEK1.md), [`D2-EVIDENCE-MAP.md`](D2-EVIDENCE-MAP.md); the decision to continue was recorded on 2026-10-22 |
| 2.6 | Planned evidence: matrix with expected and observed results, state, evidence type and acceptance per case | complete | `D2-FINAL-RUN.md` §3; the full evidence JSON is kept locally and each one records `tool.commit` |
| 2.7 | Planned evidence: fixture addresses and WASM hashes | partial | Fixture sources and `{{MARKER}}` templates are tracked; the deployed contract IDs, accounts and run output are local only (`test-fixtures/authz-fixtures/.gitignore`), so the run is not reproducible from the public repository alone |
| 2.8 | Planned evidence: custom-account demo | partial | The script and the stored-evidence demo exist (`DEMO.md`, `test-fixtures/baseline-evidence/demo.sh authz-stored`). A recorded demo is not evidenced in this repository |
| 2.9 | External acceptance (TA7 §3) | partial | The written review by the party that decides is pending. `D2-FINAL-RUN.md` is evidence, not the acceptance |

Known limitations, as stated in `D2-FINAL-RUN.md` §4: the ED-4 equality boundary (expiration equal to the simulation ledger) is not deterministic from an RPC client, so only "simulation − 1" is fixed; NA-2 and NA-3 produce the same host diagnostic and are told apart by the signed tree and the controls; the matrices and expectations were written by the same author as the product, without external review; the RPC text classifier was not checked against another RPC or protocol version; the SHA of the oldest Ed25519 runs (2026-10-22) and the cause of one nested attempt that left no file cannot be recovered.

---

## D3 — Developer workflow and CI integration

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 3.1 | Configuration file | complete | `--config` (`42876d6`); in `e852625` it also accepts `seed`, `failOn`, `failOnIncludeHypotheses`, `failOnIncomplete` and `timeout`, with flags taking precedence over the file |
| 3.2 | Seed for test-data generation; signing keys and nonces are separate | complete | `f9e5346`; `source/modules/seed.ts`, `seed.test.ts`, `chaos_monkey/seed_integration.test.ts`. The seed is recorded in the report JSON. `kuyfi authz` rejects `--seed`: its nonces are never seeded |
| 3.3 | Execution limits | complete | `42876d6` (campaign limits); `--timeout` in `e852625` (`chaos_monkey/timeout.test.ts`) |
| 3.4 | Provenance and coverage fields in the JSON | complete | Provenance: `42876d6`. Coverage, including `coverage.functionsWithoutParameters`, and `gate.decidedBy` / `triggered`: `e852625` |
| 3.5 | `--fail-on <severity>` (exit 2) and `--fail-on-incomplete` (exit 3); precedence 1, 2, 3, 0; defaults unchanged and unit-tested | complete | `e852625`; `source/modules/gate.ts`, `gate.test.ts`, `gate_cli.test.ts`, `authz/gate.test.ts`. The full AVA suite passes on this branch: 365 tests passed (run 2026-11-09). `prettier --check` and `xo` were not re-run for this document |
| 3.6 | Public GitHub Actions example repository with instructions | complete | <https://github.com/alex0tico/kuyfi-ci-example> (public): workflow `.github/workflows/kuyfi.yml`, composite action, `kuyfi.config.json`, README with local instructions and the exit-code table. It installs Kuyfi from `instawards-2-public` by default |
| 3.7 | A successful workflow run with a downloadable JSON artifact | complete | Run <https://github.com/alex0tico/kuyfi-ci-example/actions/runs/42660321215> (commit `16c61a1`, success). Job `clean-contract-passes` exits 0; the artifact `kuyfi-report-clean-contract` is downloadable |
| 3.8 | A run where a gate trips | complete | Same run: job `vulnerable-contract-is-blocked` runs `--fail-on medium` on the contract built with `--features vulnerable`. The job asserts exit code 2 and is green only because it expects the block; the artifact `kuyfi-report-vulnerable-contract` is uploaded. In a real pipeline the exit 2 would fail the job |
| 3.9 | Documentation | partial | `--help` documents the exit codes and precedence, and the example README documents usage. The main repository's README and docs pages do not yet describe `--fail-on`, `--fail-on-incomplete`, `--seed` or `--timeout`; they appear only in the working notes under `docs/instawards-2/` |
| 3.10 | Five external developers each run one campaign with the sprint build and give documented feedback (date, build, report ID, target, feedback); report the actual number if fewer complete | partial | **3 of 5** completed; **2 pending**. Two of the three are cited publicly with the authors' authorisation: (1) Diego Poveda (Local402), GitHub issue <https://github.com/alex0tico/kuyfi-ci-example/issues/1>, opened 2026-11-09; (2) Pau Koh, Vice President of Stellar Chile, feedback given by chat (no public link). The third record is kept privately and cannot be checked from this repository. The full date/build/report ID/target fields are not reproduced here for any of the three |
| 3.11 | A participant-usable build around day 21 | partial | Not evidenced in the repository: the branch has no tag, release or npm publication, and the CI example installs from the branch head. Whether participants used a pinned build is not recorded here |

---

## Open items

1. **D1 — manual audits on Contracts A/B/C:** reported by the author, no publishable evidence. If they are to count, a sanitised aggregate (no identifiers, function names or transactions) must be added.
2. **D1 — merge:** `instawards-2-public` is published but not merged into `main`.
3. **D2 — external acceptance:** the written review (TA7 §3) is pending.
4. **D2 — public reproducibility and demo:** deployed addresses are local only; no recorded demo is evidenced.
5. **D3 — external campaigns:** 3 of 5 completed (two cited publicly, one private); 2 pending.
6. **D3 — documentation and participant build:** the new flags are not yet in the main README or docs pages, and there is no pinned release for participants.
