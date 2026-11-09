# context-fixtures (D1, S1/S2)

Fixtures propias para Testnet, **sin `require_auth`**: el observable no depende de autorización (no se mezcla con D2).

- `role_gate` (S1): `init(operator)`, `privileged_set(caller, value)` → `Error(Contract, #3) NotOperator` salvo `caller == operator`; emite `role_ok` tras el chequeo. `get_operator()`/`get_value()` para verificar precondiciones.
- `ping_target` + `hook_caller` (S2): `call_hook(target)` invoca `target.ping()` y emite `hook_ok` después.

`stellar contract build && node deploy.mjs <out.json>` despliega en Testnet (relay y operador efímeros; el operador nunca firma). Las corridas usan `../baseline-evidence/run_arm.mjs`, que verifica precondiciones (read-only) y cuenta eventos observables vía `getEvents` en la ventana de ledgers de la corrida.
