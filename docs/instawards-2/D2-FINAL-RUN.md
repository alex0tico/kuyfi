# D2 — Corrida definitiva de `kuyfi authz` (2026-10-31)

Doce casos comprometidos (ED-1…5, CA-1…4, NA-1…3) ejecutados con el **producto** (`kuyfi authz`) en un despliegue **nuevo** de fixtures propias en Testnet. Contract IDs y cuentas aparecen como marcadores; la evidencia completa queda solo en local (`test-fixtures/authz-fixtures/`, en `.gitignore`).

## 1. Qué se ejecutó
| Dato | Valor |
|---|---|
| Código del producto | commit `18c68c09633179f482fa2fb65a87fff0574c3c3b` (árbol limpio: `git status` vacío antes de compilar; `dist` construido desde él). Cada JSON de evidencia lo registra en `tool.commit` |
| Cómo se registra el commit | `KUYFI_COMMIT` (fijado por el operador) o, si no existe, `git rev-parse HEAD` con marca `+dirty`. Cambio hecho en este commit; antes las corridas no lo llevaban |
| Despliegue | nuevo, identificador de corrida `final-20261031`: `<CONTRACT_ID_VAULT>`, `<CONTRACT_ID_POLICY>`, `<CONTRACT_ID_ROUTER>`, `<CONTRACT_ID_EXECUTOR>`; ninguno usado antes por el spike ni por el producto. Relay, admin, owner y actor son claves efímeras (`<ACCOUNT_RELAY>`, `<ACCOUNT_ADMIN>`, `<ACCOUNT_OWNER>`, `<ACCOUNT_NESTED_ACTOR>`); los secretos viven fuera del repositorio |
| Red / versiones | Testnet; SDK `@stellar/stellar-sdk` 14.6.1; RPC y protocolo quedan en cada JSON (`environment`) |
| Matrices (SHA-256 calculado **antes** de la primera ejecución; no se modificaron después) | |

| Matriz | SHA-256 | Ejecuciones |
|---|---|---|
| `matrix-ed25519-sim.json` (8 casos) | `97a2031c07291aaf64d06f1860728e456f9358cb27842ea0c60aab14fcfced1a` | simulación ×3 |
| `matrix-custom.json` (5) | `04ef543234fd835db0f6988b0bcc925355c86696cf5eadda91688102a2cf4fab` | simulación ×3 |
| `matrix-nested.json` (4) | `b1db5e1d18ff230974ecd9969260a89273b2bde2ba80fb52dd58e24d6b38f8c8` | simulación ×3 |
| `matrix-ed25519-onchain.json` (1) | `3e0e1fff9de799c2dda3297f94720c3dbfd9a699ddffbebada700effc498ba8f` | on-chain ×1 |
| `matrix-custom-onchain.json` (2) | `23fd9ad219edddadb48be91b15271ee17b2af58060ee984a9444752a2a2e2b78` | on-chain ×1 |
| `matrix-nested-onchain.json` (1) | `20603ab7d092020773c9c73ba48103b32a9a8672f3109cb2a4b45e8f70deccc7` | on-chain ×1 |

Resultado de cada ejecución: simulación 8/8, 5/5 y 4/4 aceptados en las 3 repeticiones; on-chain 1/1, 2/2 y 1/1. Se guardaron 12 JSON de evidencia y **ningún** registro de fallo (`kuyfi-authz-failure-*`). La salida de cada intento se guardó también en un log por ejecución (`logs/`).

## 2. Pendientes corregidos antes de correr
| Pendiente | Qué se hizo | Estado |
|---|---|---|
| Borde de ED-4 | ED-4 ahora usa `expirationOffset: 1`: expiración = ledger leído antes de simular **menos 1**. En las 3 corridas la expiración firmada fue exactamente **simulación − 1**. ED-4b conserva el caso lejano (−10) como variante, no como compromiso adicional | Cerrado para el lado "−1". El borde de **igualdad** (expiración = ledger de simulación) **no** se fija: el ledger puede avanzar entre la lectura y la simulación, así que no es determinista desde un cliente RPC |
| NA-2 y NA-3 con el mismo texto | Descripciones distintas por construcción: NA-2 = **hijo omitido** (árbol firmado: `forward` con 0 subinvocaciones); NA-3 = **argumento del hijo equivocado** (árbol: `forward` + hijo `execute` firmado con otro valor). La evidencia guarda el árbol firmado de cada uno (`entries[].tree`), que difiere (0 hijos frente a 1 hijo) | Cerrado en la **entrada**. El **diagnóstico del host sigue siendo el mismo** (`Error(Auth, InvalidAction)`, llamada sin autorización cubierta): la diferencia se demuestra por el árbol firmado y por los controles NA-1 y C-NA3, no por el texto del error |
| Intento anidado sin archivo | Las 3 ejecuciones anidadas produjeron archivo y log; el producto escribe un registro de fallo si una falla (`d65f4f1`). El intento histórico sin archivo sigue sin causa conocida y no se reconstruye | Prevención verificada; el hecho histórico queda como **no recuperable** |
| Corridas Ed25519 sin commit | Todas las corridas de esta sesión llevan `tool.commit`. Las corridas Ed25519 antiguas (2026-10-22) siguen sin SHA exacto | Cerrado hacia adelante; lo antiguo no se puede reconstruir |

## 3. Los 12 casos
*Estado:* **supported** = resultado esperado observado en 3/3 simulaciones consecutivas, con su control pareado aceptado; **hypothesis** = observado pero sin control o sin repetición; **inconclusive** = no ejecutado o no aceptado. Los casos con inclusión on-chain además muestran hash, ledger y lectura de estado. Una simulación no prueba por sí sola un cambio de estado.

| Caso | Esperado | Obtenido (3/3) | Control | Estado |
|---|---|---|---|---|
| ED-1 | éxito | éxito | — (es control de ED-2…4) | **supported**; on-chain `<TX_ED1>` ledger 5493178, SUCCESS, estado null→7 |
| ED-2 | rechazo: autorización ausente | `authorization_missing` | ED-1 | **supported** |
| ED-3 | rechazo: firma inválida | `signature_invalid` (también con firma de otra clave: ED-3b) | ED-1 | **supported** |
| ED-4 | rechazo: expirada, borde simulación−1 | `signature_expired` (expiración = ledger de simulación − 1 en las 3) | ED-1 | **supported** para el borde −1; igualdad no fijada. ED-4b (−10) igual |
| ED-5 | rechazo de contrato `NotAdmin` (#3) | `contract_error` #3, sin error de autorización | C-ED5 (admin legítimo, éxito 3/3) | **supported** |
| CA-1 | éxito | éxito | — | **supported**; on-chain `<TX_CA1>` ledger 5493181, SUCCESS, estado null→7 |
| CA-2 | rechazo dentro de `__check_auth` por firma | `check_auth_signature` | CA-1 | **supported** |
| CA-3 | éxito con evento `policy_ok` | éxito, evento observado | CA-1 | **supported**; on-chain `<TX_CA3>` ledger 5493183, SUCCESS, estado 7→100 |
| CA-4 | rechazo de política #12, tras entrar a `__check_auth` | `check_auth_policy` #12 (distinto de CA-2) | CA-3 | **supported** (CA-4b #11 exploratorio, 3/3) |
| NA-1 | éxito | éxito | — | **supported**; on-chain `<TX_NA1>` ledger 5493187, SUCCESS, estado null→5 |
| NA-2 | rechazo: hijo omitido, llamada sin cubrir | `authorization_missing` | NA-1 | **supported** (atribución por entrada: árbol de 0 hijos; texto del host idéntico al de NA-3) |
| NA-3 | rechazo: hijo firmado con argumento equivocado | `authorization_missing` | NA-1 y C-NA3 (hijo firmado para 6 con llamada 6 → éxito 3/3) | **supported** (idem) |

Controles y variantes que no cuentan como compromisos: ED-3b, ED-4b, C-ED5, CA-4b, C-NA3. Los hashes de transacción se resumen con marcadores; los valores completos están en los JSON locales.

## 4. Qué no se pudo cerrar
1. **Borde de igualdad de ED-4** (expiración = ledger de simulación): no determinista; solo se fija y registra "simulación − 1".
2. **NA-2/NA-3**: el diagnóstico del host es idéntico; la diferencia está en la entrada firmada y en los controles, no en el texto. Un cambio de RPC que altere los textos no afecta esa atribución, pero tampoco la mejora.
3. **Independencia**: las matrices y las expectativas las escribió la misma persona que escribió el producto; el despliegue es nuevo, pero el diseño no tiene revisión externa.
4. **Clasificador por texto del RPC**: sin verificar formalmente contra otra versión de RPC o protocolo; las versiones quedan en cada JSON.
5. **Datos de las corridas antiguas**: el SHA exacto de las corridas Ed25519 del 2026-10-22 y la causa del intento anidado sin archivo no son recuperables.
6. **Reproducibilidad pública**: `test-fixtures/authz-fixtures/` (contratos, generadores de matrices y evidencia) no está en el repositorio público; esta corrida solo es reproducible con esos archivos locales.
7. La aceptación de D2 sigue requiriendo la revisión escrita de quien decide (TA7 §3); este documento es evidencia, no la aceptación.
