#!/usr/bin/env bash
# Reproducible local demo of week-1 progress. Nothing is published or pushed.
# usage: demo.sh <section> ; sections: build | json | d1-stored | d1-compare | d1-config | authz-stored | authz-summary | real-stored | d1-simulate | d1-context | d2-offline | authz-product | d2-experiment
# READ-ONLY (no network, no writes outside scratch): json, d1-stored, authz-stored, real-stored, d2-offline.  RUNS LOCAL TESTS: build.
# NETWORK, simulation only: d1-simulate.  NETWORK + TESTNET TRANSACTIONS TO PROJECT-OWNED FIXTURES: d1-context, authz-product (on-chain step), d2-experiment.
# Run from the repository root. Live sections use Testnet and project-owned fixtures only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
EV=test-fixtures/baseline-evidence/context-fixtures
SCRATCH="${KUYFI_DEMO_SCRATCH:-$(mktemp -d)}"   # ephemeral secrets live here, never in the repo
LOCAL_ONLY=test-fixtures/authz-fixtures
need_local() { [ -d "$LOCAL_ONLY" ] || { echo "section '$1' needs local experiment data ($LOCAL_ONLY), which is not part of the public repository"; exit 3; }; }
case "${1:-}" in
build)        # 1 min — what is being demonstrated, on which commit
  git log --oneline -1; git status --short | head -3
  npm test 2>&1 | grep -E "warnings|tests? (passed|failed)" ;;
d1-stored)    # seconds, read-only — S1/S2 A/B/C, context config, provenance and limits from stored reports
  node test-fixtures/baseline-evidence/summarize_stored.mjs d1 ;;
authz-stored) # seconds, read-only — summary of the PRODUCT's stored authz evidence
  need_local authz-stored
  node test-fixtures/baseline-evidence/summarize_stored.mjs authz ;;
d1-compare)   # seconds, read-only — one-screen S1/S2 A/B/C + control view of stored evidence
  node test-fixtures/baseline-evidence/show_d1_comparison.mjs ;;
d1-config)    # seconds, read-only — stored simulate-only config of an own fixture + excerpt of its report
  node test-fixtures/baseline-evidence/show_config_result.mjs ;;
authz-summary) # seconds, read-only — committed cases vs additional controls vs on-chain, from stored kuyfi authz results
  need_local authz-summary
  node test-fixtures/baseline-evidence/show_authz_summary.mjs ;;
real-stored)  # seconds, read-only — aggregates of the three real-contract campaigns (stored)
  node test-fixtures/baseline-evidence/summarize_stored.mjs real ;;
d2-offline)   # seconds, no network — the signed trees really differ
  need_local d2-offline
  node test-fixtures/authz-fixtures/spike/verify_nested_trees.mjs | tail -12 ;;
authz-product) # ~4 min — the PRODUCT (kuyfi authz): clean fixture deployment, then Ed25519 + custom-account matrices (simulation) and ED-1 on-chain
  need_local authz-product
  RUN="demo-$(date +%Y%m%d-%H%M)"; K="$SCRATCH/keys.json"; OUT="$SCRATCH/authz"; mkdir -p "$OUT"
  (cd test-fixtures/authz-fixtures && stellar contract build >/dev/null && node spike/setup.mjs "$RUN" "$K" >/dev/null \
   && node matrix/gen_ed25519.mjs "$RUN" "$OUT" >/dev/null && node matrix/gen_custom_nested.mjs "$RUN" - "$OUT" >/dev/null \
   && node spike/fund_admin.mjs "$RUN" "$K" >/dev/null)
  export KUYFI_AUTHZ_ADMIN_SECRET="$(node -p "require('$K').admin")" KUYFI_AUTHZ_OWNER_SECRET="$(node -p "require('$K').owner")"
  for m in ed25519-sim custom ed25519-onchain; do node dist/cli.js authz "$OUT/matrix-$m.json" --out "$OUT" | grep -E '^  |Executed'; done
  echo "evidence: $OUT" ;;
d2-experiment) # ~5 min, EXPERIMENTAL SCRIPTS (not the product) — clean deployment + enforcing simulation x3 (ED/CA) + on-chain ED-1/CA-1/CA-3
  need_local d2-experiment
  RUN="demo-$(date +%Y%m%d-%H%M)"; K="$SCRATCH/keys.json"
  (cd test-fixtures/authz-fixtures && stellar contract build >/dev/null \
   && node spike/setup.mjs "$RUN" "$K" | head -3 \
   && node spike/matrix.mjs "$RUN" "$K" 3 matrix \
   && node spike/onchain.mjs "$RUN" "$K" >/dev/null && echo "on-chain evidence: evidence/$RUN/onchain.json") ;;
d1-simulate)  # ~1 min — simulate-only cannot send anything
  (cd "$SCRATCH" && node "$ROOT/dist/cli.js" "$(node -p "require('$ROOT/$EV/deployment.json').roleGate.contractId")" --json \
    --config "$ROOT/$EV/configs/S1-C-simulate.json" | tail -8; echo "report in $SCRATCH") ;;
d1-context)   # ~2 min — S1 with context on (broadcast to OWN fixture), observable counted from RPC events
  node test-fixtures/baseline-evidence/run_arm.mjs --arm C --scenario S1 --kind smoke --run 1 \
    --bin "$ROOT/dist/cli.js" --config "$ROOT/$EV/configs/S1-C.json" --src-repo "$ROOT" --out "$SCRATCH/s1c" ;;
json)         # seconds — provenance and coverage blocks of a stored report
  node -e 'const j=require("./'$EV'/S1/armC-sprint/run1.json");console.log(JSON.stringify({provenance:j.provenance.audit,coverage:j.coverage,campaign:j.campaign},null,1).slice(0,2500))'
  cat "$EV/COMPARISON.md" | head -22 ;;
*) echo "sections: build | json | d1-stored | d1-compare | d1-config | authz-stored | authz-summary | real-stored | d1-simulate | d1-context | d2-offline | authz-product | d2-experiment"; exit 2 ;;
esac
