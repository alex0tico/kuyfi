# D2 — Material para la revisión de viabilidad (viernes 2026-10-23, adelantada)

**Alcance.** Es la revisión de *viabilidad* del experimento enforcing (TA7 §5, "Day 7"), adelantada por decisión de Alex; el compromiso del día 7 (25 de octubre) no se modifica. **No es la aceptación de D2**: los 12 casos siguen sin aceptarse hasta la corrida definitiva y la integración en KUYFI.

## Criterio de la revisión (TA7 §5) y resultado

Criterio: en simulación enforcing, 3 corridas consecutivas con diagnósticos guardados: ED-1 ok; ED-2 y ED-3 rechazados con diagnóstico atribuible; CA-1 ok; CA-2 rechazado dentro de `__check_auth`.

| Despliegue | Commit ejecutado | Corridas consecutivas | Resultado |
|---|---|---|---|
| run-0 (calibración y primera verificación) | scripts del spike en `fbe97e5` (el árbol de trabajo coincidía con lo commiteado) | 3 | cumple |
| **run-1 (despliegue limpio, evaluadores congelados)** | `3404628` (árbol limpio) | 3 | **cumple**: ED-1, CA-1, CA-3 expected_success; ED-2…5, CA-2, CA-4 expected_rejection |

Por qué se repitió con despliegue limpio (incertidumbre concreta que resuelve): en run-0 las expresiones de atribución se fijaron mirando la corrida de calibración sobre esos mismos contratos. run-1 usa otros contratos, otros actores y otros ledgers **sin recalibrar**, de modo que el resultado no depende de haber ajustado el evaluador a una sola instancia. Toda la evidencia de run-0 se conserva.

Versiones: SDK `@stellar/stellar-sdk` 14.6.1; RPC Testnet `30.0.0-13e53516…`, protocolo 29 (consultado el 2026-10-21 durante la corrida run-1; misma versión que en run-0). Fixtures: `Vault` `d89b96ff…`, `PolicyAccount` `b50ef76d…`, `Executor` `87b54489…`, `Router` `dddb61b0…`.

## Los 12 casos

Leyenda — *Ejecución*: todo se probó con **scripts experimentales** (`test-fixtures/authz-fixtures/spike/*.mjs`), **no con el producto KUYFI** (el producto aún no construye ni firma entradas de autorización). *Sim* = simulación enforcing explícita (`authMode: "enforce"`); *On-chain* = transacción incluida (hash, ledger, lectura de estado).

| Caso | Resultado esperado | Evidencia disponible (run-0 / run-1) | Control pareado | Qué falta para la aceptación definitiva |
|---|---|---|---|---|
| ED-1 | Éxito | Sim ×3 + ×3; **On-chain** run-0 `5af249f2…` L5313371; run-1 `6a617c39…` L5315261; estado null→7 | (es el control de ED-2…4) | Corrida definitiva desde el producto |
| ED-2 | Rechazo en autorización (`Auth, InvalidAction`, "Unauthorized function call for address") | Sim ×3 + ×3 | ED-1 | idem |
| ED-3 | Rechazo en verificación de firma (`Crypto, InvalidInput`, "failed ED25519 verification") | Sim ×3 + ×3 (también con firma de otra clave) | ED-1 | idem |
| ED-4 | Rechazo por expiración (`Auth, InvalidInput`, "signature has expired") | Sim ×3 + ×3; ledgers de expiración y actual en el diagnóstico | ED-1 | idem; fijar el borde "simulación−1" con ledger controlado (hoy solo ±2 y −10) |
| ED-5 | Rechazo de contrato `Error(Contract, #3)` NotAdmin, sin error de Auth | Sim ×3 + ×3 | C-ED5 (admin legítimo) | idem |
| CA-1 | Éxito | Sim ×3 + ×3; **On-chain** run-0 `3e0ce950…` L5313379; run-1 `49ca8d41…` L5315267; estado null→7 | C-CA = CA-1 | idem |
| CA-2 | Rechazo **dentro de `__check_auth`** (frames del contrato `PolicyAccount`, `verify_sig_ed25519`) | Sim ×3 + ×3 | CA-1 | idem |
| CA-3 | Éxito con evento `policy_ok` | Sim ×3 + ×3 (evento verificado); **On-chain** run-0 `a1209789…` L5313383; run-1 `5187295c…` L5315271; estado 7→100 | CA-1 | idem |
| CA-4 | Rechazo de política `Error(Contract, #12)` distinto del de CA-2, tras entrar a `__check_auth` | Sim ×3 + ×3 (CA-4b `#11` exploratorio) | CA-3 | idem |
| NA-1 | Éxito | Sim ×3 + ×3 + ×3 (v2); **On-chain** run-0 `99c7c83a…` L5314005; run-1 `ea8b3811…` L5315289; v2 `d74b226f…` L5315307; estado null→5 | C-NA | idem |
| NA-2 | Rechazo: la `require_auth` de `execute` queda sin cubrir | Sim ×3 + ×3 + ×3 | NA-1 | idem |
| NA-3 | Rechazo: sin árbol coincidente (hijo firmado con otro monto) | Sim ×3 + ×3 + ×3 | NA-1 y **C-NA3** (hijo firmado para 6 con llamada con 6 → éxito ×3) | idem |

Archivos: `evidence/run-0/` y `evidence/run-1/` (`matrix-enforce-simulation.json`, `onchain.json`, `nested-enforce-simulation*.json`, `setup.json`, `nested-setup*.json`). No hubo resultados inesperados en ninguna corrida, por lo que **no existen registros de discrepancia/re-prueba** que acompañar; la única observación operativa es el actor sin fondear (documentada). Un fallo de red transitorio (TLS/socket) abortó el primer intento de `nested.mjs` en run-1 antes de producir resultados; se repitió.

### NA-2 y NA-3: ¿construyen realmente la diferencia?
- Verificado **sin red** (`spike/verify_nested_trees.mjs`, `evidence/run-0/nested-tree-verification.json`): con la misma función `nestedTree()` que usa el ejecutor, NA-2 firma solo `forward(A,5)` (0 hijos); NA-3 firma `forward(A,5)` con hijo `execute(A,6)`; NA-1 firma `execute(A,5)`. Los tres payloads SHA-256 son distintos con el mismo nonce y expiración.
- **Los diagnósticos de NA-2 y NA-3 son idénticos** (ambos: el nodo `execute(A,5)` que ocurre no está cubierto). Compartir el código no invalida los casos, pero el texto **no** distingue la causa. La atribución descansa en el diseño de una sola variable respecto del control: NA-1 difiere de NA-2 solo en la omisión del hijo, y de NA-3 solo en el monto del hijo; C-NA3 demuestra que un hijo firmado para otro monto funciona cuando la llamada coincide. Eso es lo que permite atribuir cada rechazo a su condición.

## Decisión de Alex: continuar con la implementación (registrada el 2026-10-22)

**Fecha real de la decisión: jueves 2026-10-22** (comunicada durante la sesión de trabajo de esa fecha; no se fecha el viernes 23 aunque la revisión de viabilidad se haya adelantado a esa fecha). Alex decidió **continuar con el enfoque demostrado**, sustentado en la evidencia de run-0 y run-1.

Alcance de la decisión: reconoce la **viabilidad** del enfoque. **No** declara aceptados los 12 casos del producto: deben integrarse y validarse desde KUYFI y pasar la corrida definitiva (ver más abajo). No se repiten experimentos completos salvo que una modificación o incertidumbre concreta lo justifique.

## Integración en el producto (estado al 2026-10-22)

Interfaz elegida: **`kuyfi authz <matrix.json> [--out <dir>]`**, subcomando del CLI existente (`authz` nunca es un Contract ID válido, así que no colisiona con `kuyfi <CONTRACT_ID>`). Lógica reutilizable en `source/modules/authz/`:

| Pieza | Archivo | Contenido |
|---|---|---|
| Ejecución y autorización (producto) | `entries.ts`, `run.ts` | entradas Ed25519 y de cuenta personalizada (ScMap con nombres de campo configurables, claves ordenadas), árbol anidado, nonce por ejecución (CSPRNG, nunca de una semilla), expiración relativa al ledger de simulación, **`authMode: "enforce"` siempre explícito**, relay efímero como fuente y actores separados (error si coinciden), `simulate-only` bloquea `sendTransaction` en la capa de red, `broadcast` exige `authorizationRecord` |
| Configuración específica de fixtures | `test-fixtures/authz-fixtures/matrix/gen_*.mjs` + `matrix/run-1/*.json` | Contract IDs, actores, **resultados esperados** y controles; el producto no conoce Vault/PolicyAccount/Router/Executor |
| Evaluadores y criterios | `evaluate.ts` (genérico), expectativas dentro de cada matriz | estados de TA7 §1.4, ejecutado vs aceptado, control pareado, evidencia `on-chain` exigible, evento esperado |
| Clasificador de etapa | `classify.ts` | etapas por patrones del texto del RPC (versionados; no estable) |
| Evidencia | `kuyfi-authz-<id>-<ts>.json` | JSON con versiones (tool, SDK, RPC, protocolo), cuentas públicas, entradas suministradas (sin firmas ni claves), observado, evaluación; escritura con `wx` (no sobrescribe) |

Claves de actores: `ephemeral` (generada y fondeada) o `env` con el **nombre** de una variable de entorno; la matriz no admite secretos. El JSON no contiene secretos (búsqueda de patrón `S…` sin coincidencias, y prueba automática).

### Pruebas del producto (independientes del ejecutor)
- La firma se verifica contra `authorizeEntry` del SDK (implementación independiente) y el payload contra una reconstrucción manual del preimage.
- El "contrato" falso de las pruebas juzga la transacción **realmente enviada** con su propio código, y hay fakes defectuosos que el producto debe detectar: *acepta todo* → `unexpected_acceptance`; *rechaza todo* → `unexpected_rejection` (y los rechazos pierden atribución por el control fallido); *texto de rechazo de otra etapa* → no aceptado; *fallo de transporte* → `inconclusive`, nunca un rechazo.
- El clasificador se prueba con textos reales grabados de Testnet (no son evidencia de rechazo).

### Validación del producto contra las fixtures de run-1 (2026-10-22)
Se ejecutó `kuyfi authz` sobre el **despliegue run-1 ya existente** (sin redeploy; no se repitió el experimento, se validó el producto). Los resultados esperados son los de run-0/run-1; **no son una calibración nueva**. Evidencia: `test-fixtures/authz-fixtures/evidence/product-run-1/`.

| Matriz | Caso(s) | Simulación enforcing (corridas) | Resultado |
|---|---|---|---|
| Ed25519 (`ed25519-run-1`) | ED-1, ED-2, ED-3 (+3b firma ajena), ED-4, C-ED5, ED-5 | 3 consecutivas | 7/7 `accepted` cada una |
| Cuenta personalizada (`custom-account-run-1`) | CA-1, CA-2 (`check_auth_signature`), CA-3 (evento `policy_ok` observado), CA-4 (`check_auth_policy` #12), CA-4b (#11, exploratorio) | 3 consecutivas | 5/5 cada una |
| Anidada (`nested-run-1`) | NA-1, NA-2, NA-3, C-NA3 | 3 exitosas (un intento adicional no produjo archivo y no se capturó su error: intento sin resultado recuperable, causa desconocida; ver `D2-EVIDENCE-MAP.md` §3) | 4/4 cada una |

Inclusión on-chain **desde el producto** (modo `broadcast` con `authorizationRecord`, fixtures propias):

| Caso | Hash | Ledger | Estado | Lectura de estado |
|---|---|---|---|---|
| ED-1 | `2a0c82604eba029e61ca25a935204d9cf5ce2937d2cf862f46c219b802a31d69` | 5331117 | SUCCESS | null → 7 |
| CA-1 | `83be89433050…` (ver JSON) | 5331204 | SUCCESS | 100 → 7 |
| CA-3 | `5a4aec71c04d…` (ver JSON) | 5331209 | SUCCESS | 7 → 100 |
| NA-1 | `0a2ad6d3dcd3…` (ver JSON) | 5331216 | SUCCESS | null → 5 |

(CA-1: la lectura previa era 100 porque este despliegue ya había ejecutado CA-3 en pruebas anteriores; la condición del caso —que el estado pase a 7 tras el ledger— se cumple.)

Código ejecutado: **corrección (2026-10-22)** — `fe162a5` solo vale para custom y anidada (corridas desde 11:30:29). Las corridas Ed25519 (11:24–11:26) ocurrieron antes de ese commit y su SHA exacto no está registrado. Reconstrucción completa, hashes de matriz y contratos en `D2-EVIDENCE-MAP.md`. Los informes no llevan SHA porque el CLI distribuido no tiene git; desde `d65f4f1` llevan el SHA-256 de la matriz.

### Por qué esto todavía NO es la aceptación de D2
1. Es el **mismo despliegue** (run-1) con expectativas calibradas en run-0: no es la corrida definitiva independiente. Falta la corrida definitiva de los 12 casos con las matrices congeladas, un despliegue limpio y el SHA fijado.
2. `accepted` en el informe del producto es la evaluación automática contra la matriz; la aceptación de D2 (TA7 §3) exige además los registros de re-prueba, la revisión por escrito y las cuatro evidencias on-chain en el formato final.
3. El despliegue de las fixtures sigue en scripts (`spike/*.mjs`), no en el producto; ED-4 no fija el borde exacto de expiración; NA-2/NA-3 siguen compartiendo texto (la atribución es por diseño de variable única y el control C-NA3).
4. Pendiente: documentar versiones de clasificador por versión de RPC, y decidir si `authz` debe exponer `--fail-*` (D3).

## Trabajo para integrar el experimento en KUYFI — lista original (ver estado arriba)
1. Módulo de producto (p. ej. `source/modules/authz/`): constructor de entradas (Ed25519 y cuenta personalizada), payload (SHA-256 del preimage) con prueba cruzada contra `authorizeEntry` del SDK, árbol anidado, fuente de nonce **por ejecución** (nunca derivada de la semilla), expiración relativa al ledger de simulación.
2. Ejecutor de simulación con `authMode` explícito y cuenta relay como fuente; actores fondeados por el harness.
3. Clasificador de etapa (autorización / firma / expiración / contrato / `__check_auth` / política) sobre eventos de diagnóstico, con las expresiones calibradas **versionadas** y pruebas con respuestas grabadas (solo para la lógica de clasificación, no como evidencia de rechazo black-box).
4. Runner de la matriz: estados de TA7 §1.4, controles pareados, aceptado vs ejecutado, registro de re-pruebas, escritura de evidencia con commit y versiones.
5. Despliegue reproducible de las 4 fixtures (hoy `setup.mjs`/`nested.mjs`).
6. Decisión de Alex: si se expone por CLI (`kuyfi authz …`) o queda como runner del repositorio. La postulación pide la capacidad y la evidencia, no un comando concreto.
7. Corrida definitiva de los 12 casos con el producto, con las 4 evidencias on-chain (ED-1, CA-1, CA-3, NA-1).

## Riesgos abiertos
Atribución basada en texto de eventos (puede cambiar con el RPC); protocolo 29 / core 30 frente a SDK 14.6.1 sin verificación formal de XDR; contradicción entre las dos páginas oficiales sobre el valor por defecto de `authMode` (se evita enviando siempre el modo explícito); NA-2/NA-3 sin discriminación por texto; borde exacto de expiración sin ledger fijo.
