# D2 — Spike de viabilidad (semana 1): `authMode: "enforce"` en Testnet

Fecha de ejecución: 2026-10-21 (Testnet). Rama `instawards-2/week-1`. SDK instalado: `@stellar/stellar-sdk` 14.6.1 (sin actualizar). RPC: `https://soroban-testnet.stellar.org`, versión `30.0.0-13e53516…`, `protocolVersion` 29 (`getVersionInfo`, 2026-10-21).

**Alcance de este documento.** Es un experimento de viabilidad sobre fixtures propias. **No** declara D2 cumplido, **no** es la revisión formal del día 7 (la decisión aprobada/parcial/no aprobada es de Alex) y **no** acepta casos: la matriz de 12 casos sigue pendiente (NA-1…3, repeticiones definitivas, controles pareados completos, evidencia on-chain de NA-1).

## Reproducción

```
cd test-fixtures/authz-fixtures
stellar contract build                       # vault.wasm, policy_account.wasm (soroban-sdk 25)
node spike/setup.mjs   <runId> <keys.json>   # fondea relay, despliega Vault y PolicyAccount
node spike/probe.mjs   <runId> <keys.json>   # ¿acepta/valida el RPC authMode?
node spike/matrix.mjs  <runId> <keys.json> 3 matrix   # ED-1…5, CA-1…4 (+controles) x3, simulación enforcing
node spike/onchain.mjs <runId> <keys.json>   # ED-1, CA-1, CA-3 on-chain; nonce; expiración
node spike/footprint.mjs <runId> <keys.json> # footprint record vs enforce
```

`<keys.json>` contiene claves efímeras de Testnet (relay, admin, owner) y se escribe fuera del repo (modo 0600); ningún script escribe secretos en evidencia (búsqueda de patrón `S…`(56) en `test-fixtures/authz-fixtures`: sin coincidencias). Los actores A y B se generan por ejecución y se fondean con Friendbot.

## Fixtures desplegadas (run-0, Testnet)

| Fixture | Contract ID | WASM hash |
|---|---|---|
| `Vault` | `<CONTRACT_ID_4>` | `d89b96ff018cca07e4ce5d373145b912df8c94c611111e2eb516c4a39ed4395d` |
| `PolicyAccount` | `<CONTRACT_ID_2>` | `b50ef76d35544ddf4f38eea94c5b9ac4971bdb538ce4e89f89bea8f655ac5ad8` |

Relay (fuente de toda transacción): `<ACCOUNT_3>`. `Router`/`Executor` (NA) **no** están construidos.

## Supuestos de TA7 §7 — resultados observados

| # | Supuesto | Observado | Evidencia |
|---|---|---|---|
| 1 | El RPC de Testnet acepta `authMode: "enforce"` | **Sí, y valida el campo**: un valor inválido devuelve `optional 'authMode' must be one of enforce,record,record_allow_nonroot when included`. Sin entradas y sin modo: se ejecuta en *recording* (devuelve 1 entrada de auth). `enforce` sin entradas: `Error(Auth, InvalidAction)` + "Unauthorized function call for address". `record` con entradas: `cannot set authMode to 'record' with an auth footprint`. | `evidence/run-0/probe-authmode.json` |
| 2 | Códigos de error | Ver tabla de calibración abajo | `evidence/run-0/calib-enforce-simulation.json`, `matrix-enforce-simulation.json` |
| 3 | El footprint de `__check_auth` de la simulación enforcing basta para enviar | **Sí para esta fixture**: CA-1 y CA-3 se incluyeron en ledger con `SUCCESS` usando `assembleTransaction` sobre la simulación enforcing, conservando la entrada de auth (1) | `evidence/run-0/onchain.json` |
| 4 | La expiración se evalúa de forma consistente con el ledger de simulación | Expiración = ledger de simulación → válida (1 observación); expiración < ledger de simulación → `signature has expired` (`Error(Auth, InvalidInput)`) en ±2 ledgers y −10. **No** se probó el borde exacto "simulación − 1" con ledger fijo (el ledger avanza entre llamadas) | `onchain.json` (`expiry`), `matrix-…` (ED-4) |
| 5 | ¿Una simulación enforcing consume nonce? | **No**: la misma entrada simulada dos veces → ambas OK. La inclusión on-chain **sí**: reenviar la misma entrada → `Error(Auth, ExistingValue)` "nonce already exists for address"; mismo nonce con payload distinto → igual rechazo; nonce nuevo → OK | `onchain.json` (`nonce`) |

### Calibración de rechazos (corrida `calib`, 1 ejecución; luego verificada en `matrix`, 3 corridas)

| Caso | Observado | Etapa atribuible |
|---|---|---|
| ED-2 sin entrada | `Error(Auth, InvalidAction)`; "Unauthorized function call for address" | Autorización |
| ED-3 firma corrupta (y firma de otra clave) | `Error(Auth, InvalidAction)` con "failed account authentication with error … Error(Crypto, InvalidInput)" y "failed ED25519 verification" | Verificación de firma |
| ED-4 expirada | `Error(Auth, InvalidInput)`; "signature has expired" (con ledger de expiración y ledger actual) | Expiración |
| ED-5 sin permiso | `Error(Contract, #3)` (`NotAdmin`) sin eventos de error de Auth; `fn_call admin_set` presente | Contrato (después de `require_auth`) |
| CA-2 firma corrupta | "failed account authentication" + eventos del contrato `PolicyAccount`: `verify_sig_ed25519`, `VM call trapped … __check_auth`, `Error(Crypto, InvalidInput)` | Dentro de `__check_auth` |
| CA-4 monto sobre límite | `Error(Contract, #12)` (`AmountExceeded`) tras `fn_call … __check_auth` con los contextos | Política dentro de `__check_auth` |
| CA-4b función no permitida (exploratorio) | `Error(Contract, #11)` | Política |

**Hallazgo operativo:** una cuenta G **no fondeada** como actor produce `Error(Auth, InvalidAction)` con `Error(Storage, MissingValue)` ("trying to get non-existing value for account") incluso con firma válida (observado en `probe.mjs`). El actor debe existir en el ledger; de lo contrario ED-3/ED-1 quedarían mal atribuidos. `matrix.mjs` fondea a los actores.

**Diferencia observada entre `PolicyAccount` en record y enforce (CA-1):** las claves del footprint son iguales; las instrucciones difieren (687.105 en record sin entradas vs 1.324.198 en enforce firmada). Registrado como observación; la afirmación de TA7 sobre el footprint de `__check_auth` se mantiene como cautela, no se confirma ni se refuta para claves de ledger.

## Resultados de simulación enforcing (3 corridas consecutivas, `matrix-enforce-simulation.json`)

Cada corrida: fuente = relay, actor distinto, nonce nuevo, estados de TA7 §1.4. Control pareado: ED-1 (ED-2/3/4), C-ED5 (ED-5), CA-1 (CA-2), CA-3 (CA-4).

| Corrida | ED-1 | C-ED5 | CA-1 | CA-3 (con evento `policy_ok`) | ED-2 | ED-3 | ED-4 | ED-5 | CA-2 | CA-4 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1, 2, 3 | expected_success | expected_success | expected_success | expected_success | expected_rejection | expected_rejection | expected_rejection | expected_rejection | expected_rejection | expected_rejection |

Las expresiones de atribución del evaluador (`matrix.mjs`) se fijaron a partir de la corrida de calibración; esto es calibración permitida por TA7 §1.5, no una corrida definitiva. Había 0 reintentos de transporte en `onchain.json`; en `matrix` una corrida previa murió por timeout de red (`ETIMEDOUT`) antes de añadir reintentos acotados; se repitió completa.

## Evidencia on-chain (run-0)

| Caso | Hash | Ledger | Estado | Lectura de estado tras el ledger |
|---|---|---|---|---|
| ED-1 | `5af249f2d59cdd13861a36e9d1752e6473b8704b38439e7a0ca26e907daf4eb0` | 5313371 | SUCCESS | `get(A)`: null → 7 |
| CA-1 | `3e0ce9507f2205e825e4dc47ff260498defe76df8377b86f591d563baff2ffad` | 5313379 | SUCCESS | `get(PolicyAccount)`: null → 7 |
| CA-3 | `a120978924e7c70e13524fad756001610dfa04cd89001c21d0a237b6fab3a6f1` | 5313383 | SUCCESS | `get(PolicyAccount)`: 7 → 100 |

La lectura de estado es una simulación de `get` (solo lectura) posterior al ledger. NA-1 on-chain: pendiente (`Router`/`Executor` no existen). El campo `feeCharged` de `onchain.json` es un marcador, no un dato medido.

## NA-1…3 (anidada) — ejecutado el 2026-10-21

Fixtures `Router` `<CONTRACT_ID_3>` (WASM `dddb61b042e5d147c8e05b5a53aee9f239bfc3c6fcb43d44fc235e0bc05832b4`) y `Executor` `<CONTRACT_ID_5>` (WASM `87b54489aaa66e4eb729d30f46e7075da672249ff49ca98180bed509e6267767`). Actor Ed25519 fondeado; fuente = relay.

| Caso | Material | Simulación enforcing ×3 | On-chain |
|---|---|---|---|
| NA-1 | Árbol firmado `forward(A,5)` → `execute(A,5)` | expected_success ×3 | **SUCCESS**, hash `99c7c83ae740939e5a99b62d95a4c6a89de5680b3f4911c5300ef96f2a36ed06`, ledger 5314005, `Executor.get(A)`: null → 5 |
| NA-2 | Solo el nodo raíz firmado | expected_rejection ×3: `Error(Auth, InvalidAction)` "Unauthorized function call for address", con `fn_call` a `execute` | — |
| NA-3 | Nodo interno firmado para 6 ≠ 5 | expected_rejection ×3: mismo código y diagnóstico | — |

Archivo: `evidence/run-0/nested-enforce-simulation.json`. Observación: NA-2 y NA-3 producen el **mismo** código y texto de rechazo; los distingue solo el material firmado (control NA-1 con el mismo actor y fuente). Esto es evidencia de viabilidad, no aceptación: falta la corrida definitiva con despliegue limpio y registro de re-pruebas.

## Discrepancia sobre `authMode`: documentación primaria vs. observado

Versiones: SDK `@stellar/stellar-sdk` 14.6.1; RPC Testnet `30.0.0-13e53516…`, `protocolVersion` 29 (2026-10-21).

**Documentación primaria leída (páginas completas, 2026-10-21):**
- Referencia del método RPC `simulateTransaction`: `authMode` ∈ `enforce` (por defecto) | `record` | `record_allow_nonroot`; no dice nada sobre el efecto de que haya o no entradas de autorización.
- Guía "Transaction simulation": el modo *recording* es "the default approach" y "never emulates authorization failures"; pasar `auth` a `Operation.invokeContractFunction` "will imply enforcement mode".
- **Las dos páginas oficiales se contradicen en el valor por defecto.**

**Observado en el RPC de Testnet** (`evidence/run-0/probe-authmode.json`, `source-actor-enforce.json`; solicitudes JSON-RPC reales):

| `authMode` | Entradas de auth | Resultado |
|---|---|---|
| omitido | ninguna | Simulación OK, **devuelve 1 entrada de auth** (comportamiento *recording*) — coincide con la guía, no con la referencia RPC |
| omitido | firmadas | Se evalúa en enforcing (la entrada se verifica) |
| `enforce` explícito | ninguna | `Error(Auth, InvalidAction)` ("Unauthorized function call for address") |
| `enforce` explícito | firmadas, válidas | OK |
| `record` explícito | firmadas | Rechazado: `cannot set authMode to 'record' with an auth footprint` |
| valor inválido | — | `optional 'authMode' must be one of enforce,record,record_allow_nonroot when included` |
| `enforce` explícito, ninguna entrada, **actor = cuenta fuente** | — | `Error(Auth, InvalidAction)` (la autorización implícita de la fuente **no** se emula en enforce sin entradas) |

Conclusión: para rechazo atribuible hay que **enviar `authMode: "enforce"` explícito** (ED-2 lo exige); omitirlo da recording. Además, `enforce` sin entradas no replica una transacción difundida (que sí autoriza a su cuenta fuente), por lo que simulate-only de KUYFI (recording) no puede evaluar hipótesis de control de acceso: se informa como `NOT_EVALUATED`.

Stellar Raven MCP: sigue sin conectar (`CONNECT_TIMEOUT`); no se usó.

## Conclusión verificable de la semana 1 (D2)

**Hipótesis demostradas como evidencia de viabilidad (no aceptación):**

| Hipótesis | Tipo de evidencia | Estado |
|---|---|---|
| El RPC de Testnet acepta y valida `authMode: enforce` | Solicitudes/respuestas reales | Demostrada |
| Ed25519: autorización válida / ausente / firma inválida / expirada / sin permiso producen estados distintos y atribuibles | **Simulación** enforcing, 3 corridas consecutivas | Demostrada en simulación |
| Custom account: firma válida OK; firma inválida rechazada dentro de `__check_auth`; política permitida / denegada con códigos distintos | **Simulación** enforcing, 3 corridas | Demostrada en simulación |
| Fuente (relay) separada del actor evaluado | Todas las corridas | Demostrada |
| Anidada: árbol correcto OK; nodo interno omitido o con argumentos distintos rechazado | **Simulación** ×3 + NA-1 **on-chain** | Demostrada (viabilidad) |
| ED-1, CA-1, CA-3 se incluyen en ledger y cambian el estado | **Transacciones incluidas** (hash, ledger, lectura de estado) | Demostrada (run-0) |
| Footprint de `__check_auth` de la simulación enforcing basta para enviar | Transacciones CA-1/CA-3 | Demostrada para esta fixture |
| Nonce: simulación no lo consume; inclusión sí | Simulación + reenvío | Demostrada |
| Expiración inclusiva en el ledger de simulación | Simulación (1 observación en el borde) | Parcial |

**Qué falta para la matriz definitiva:** corridas definitivas (NA-1…3 ya ejecutados como viabilidad, con NA-1 on-chain); con despliegue limpio y registro de re-pruebas; ED-5/C-ED5 y CA-4 con su evidencia en el formato final; ED-1/CA-1/CA-3 ya tienen on-chain pero con el harness del spike; integración del harness en `source/`; la decisión del día 7 (el 25 de octubre si se cuenta el 19 como día 1; se puede adelantar la revisión al viernes 23 sin cambiar el criterio).

**Riesgos abiertos:** NA-2/NA-3 indistinguibles por código (solo por material); atribución basada en texto de eventos de diagnóstico (puede cambiar con el RPC); protocolo 29 / core 30 vs. SDK 14.6.1 (sin incidencias, sin verificación formal); una sola implantación de fixtures; contradicción documental sobre el valor por defecto; NA aún sin ejecutar.

## Fuentes y límites

- Stellar Raven MCP: **no conectó** en esta sesión (`CONNECT_TIMEOUT`); no se contrastó con él.
- Documentación oficial: ver la sección "Discrepancia sobre `authMode`" (páginas completas leídas; el resumen de búsqueda inicial ya no es la base).
- El RPC corre protocolo 29 / stellar-core 30.0.0; el SDK 14.6.1 funcionó sin incidencias en este spike, pero no se verificó compatibilidad formal de XDR por protocolo.
- Una sola implantación (run-0) y un solo momento de red. La atribución se basa en texto de eventos de diagnóstico, que puede cambiar entre versiones del RPC.

## Qué queda para cerrar D2

`Router`/`Executor` y NA-1…3; EDs con actores fondeados desde el harness del producto (hoy el harness vive en `test-fixtures/authz-fixtures/spike`, excluido de XO/Prettier, y no está integrado en `source/`); definición de contratos de error estable por caso; corridas definitivas con registro de re-pruebas; evidencia on-chain de NA-1; revisión formal del día 7 por Alex.
