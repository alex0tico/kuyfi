# Comparación D1 — S1/S2 (tres brazos)

Unidad de comparación: función + vector + clasificación; el observable es el evento emitido por la fixture (`role_ok` / `hook_ok`) contado vía RPC `getEvents` en la ventana de ledgers de cada corrida. Es una observación, no una medida de efectividad.

## S1

| Brazo | Corrida | Commit / paquete | Observable | Vectores / broadcast | Hallazgos | Notas |
|---|---|---|---|---|---|---|
| A (v0.1.0 (npm @kuyfi/kuyfi@0.1.0)) | 1 | 0.1.0@undefined | 0 `role_ok` | 14 / 0 | 0 | exit 0 |
| A (v0.1.0 (npm @kuyfi/kuyfi@0.1.0)) | 2 | 0.1.0@undefined | 0 `role_ok` | 14 / 0 | 0 | exit 0 |
| A (v0.1.0 (npm @kuyfi/kuyfi@0.1.0)) | 3 | 0.1.0@undefined | 0 `role_ok` | 14 / 0 | 0 | exit 0 |
| B (sprint, context off) | 1 | b87692a | 0 `role_ok` | 14 / 0 | 0 | exit 0 |
| B (sprint, context off) | 2 | b87692a | 0 `role_ok` | 14 / 0 | 0 | exit 0 |
| B (sprint, context off) | 3 | b87692a | 0 `role_ok` | 14 / 0 | 0 | exit 0 |
| C (sprint, context on) | 1 | b87692a | 6 `role_ok` | 14 / 6 | 1: privileged_set::UNAUTHORIZED_ADDR_CALL:POTENTIAL_VULN:HIGH | exit 0 |
| C (sprint, context on) | 2 | b87692a | 6 `role_ok` | 14 / 6 | 1: privileged_set::UNAUTHORIZED_ADDR_CALL:POTENTIAL_VULN:HIGH | exit 0 |
| C (sprint, context on) | 3 | b87692a | 6 `role_ok` | 14 / 6 | 1: privileged_set::UNAUTHORIZED_ADDR_CALL:POTENTIAL_VULN:HIGH | exit 0 |

## S2

| Brazo | Corrida | Commit / paquete | Observable | Vectores / broadcast | Hallazgos | Notas |
|---|---|---|---|---|---|---|
| A (v0.1.0 (npm @kuyfi/kuyfi@0.1.0)) | 1 | 0.1.0@undefined | 0 `hook_ok` | 3 / 0 | 0 | exit 0 |
| A (v0.1.0 (npm @kuyfi/kuyfi@0.1.0)) | 2 | 0.1.0@undefined | 0 `hook_ok` | 3 / 0 | 0 | exit 0 |
| A (v0.1.0 (npm @kuyfi/kuyfi@0.1.0)) | 3 | 0.1.0@undefined | 0 `hook_ok` | 3 / 0 | 0 | exit 0 |
| B (sprint, context off) | 1 | b87692a | 0 `hook_ok` | 3 / 0 | 0 | exit 0 |
| B (sprint, context off) | 2 | b87692a | 0 `hook_ok` | 3 / 0 | 0 | exit 0 |
| B (sprint, context off) | 3 | b87692a | 0 `hook_ok` | 3 / 0 | 0 | exit 0 |
| C (sprint, context on) | 1 | b87692a | 1 `hook_ok` | 3 / 1 | 1: call_hook::UNAUTHORIZED_ADDR_CALL:POTENTIAL_VULN:HIGH | exit 0 |
| C (sprint, context on) | 2 | b87692a | 1 `hook_ok` | 3 / 1 | 1: call_hook::UNAUTHORIZED_ADDR_CALL:POTENTIAL_VULN:HIGH | exit 0 |
| C (sprint, context on) | 3 | b87692a | 1 `hook_ok` | 3 / 1 | 1: call_hook::UNAUTHORIZED_ADDR_CALL:POTENTIAL_VULN:HIGH | exit 0 |

## Corridas de humo (no formales)

- `S1/armC-simulate-only-smoke`
- `S1/armC-smoke`
