# D2 — Mapa de evidencia (reconstruido desde los archivos, 2026-10-22)

Complementa `D2-REVIEW-FRIDAY.md`. Todo lo de abajo sale de commits, marcas de tiempo de archivos y los JSON de evidencia; donde un dato **no** está registrado se dice. No es la aceptación de D2.

## 1. Aclaración de una contradicción del resumen anterior
El resumen decía que la validación del producto se hizo "sobre run-1" y también que las expectativas se calibraron "en el mismo despliegue". Lo correcto, según los archivos:

| Hecho | Detalle |
|---|---|
| Calibración de las expectativas (etapas, códigos de contrato, eventos) | **run-0** (2026-10-21 ~10:43, `evidence/run-0/calib-enforce-simulation.json`), contratos `CD5Z3AX3…` (Vault) y `CAEFAM2A…` (PolicyAccount) |
| run-1 | despliegue **distinto** (otros contratos, actores y ledgers), ejecutado **sin recalibrar** con los evaluadores congelados (`3404628`). Ningún valor esperado se ajustó mirando run-1 |
| Validación del producto (2026-10-22) | sobre **run-1**: un despliegue no usado para calibrar, pero **ya usado** por el spike (3 corridas + on-chain) |
| Lo que sigue sin ser independiente | las matrices del producto las escribió el mismo autor que las expectativas de run-0; el despliegue se reutilizó; la evidencia no registraba SHA ni hash de la matriz (corregido, ver §5) |

Conclusión: la validación del producto es **válida como prueba de que `kuyfi authz` reproduce lo observado por el spike en un despliegue no calibrado**, pero no es la corrida definitiva independiente (§4).

## 2. Ejecuciones y artefactos
Hora local de las marcas = UTC−3. "Matriz fijada" es el momento en que quedaron los archivos de matriz (mtime del archivo, anterior a la primera ejecución en todos los casos; los archivos no se modificaron después).

| Ejecución | Código ejecutado | Matriz (SHA-256) y momento de fijación | Despliegue (Contract IDs) | Casos y resultado | Artefactos |
|---|---|---|---|---|---|
| Spike run-0 (sim ×3, on-chain, nested) | `fbe97e5` (árbol coincidente) — scripts `spike/*.mjs`, **no el producto** | n/a (expectativas dentro del script, calibradas en `calib-…`) | Vault `CD5Z3AX3…K45W`, Policy `CAEFAM2A…ROJLA2`; nested Executor `CD7ONQC5…`, Router `CAON7DNT…` | 12 compromisos + controles; sim ×3, on-chain | `evidence/run-0/` |
| Spike run-1 (despliegue limpio, evaluadores congelados) | `3404628` (árbol limpio) | n/a (idem, sin recalibrar) | Vault `CBQTLVR6…57IG`, Policy `CBZHNF3A…D4J6Z`; nested v1 `CBLV7A2X…`/`CD45A4NP…`, v2 `CCCHYWWO…`/`CB5VTCZS…` | sim ×3 (+ ×3 nested v2), on-chain ED-1, CA-1, CA-3, NA-1 | `evidence/run-1/` |
| **Producto, Ed25519 sim** | **no registrado en la evidencia.** Corridas 11:24:19–11:25:45; el árbol estaba entre `9a96d8d` (11:23:46) y `fe162a5` (11:30:02). `dist` no se compiló desde un commit identificado | `matrix-ed25519-sim.json` `293c0652…`; archivo escrito 11:23:46, antes de la 1.ª corrida | run-1 Vault `CBQTLVR6…` | 7/7 aceptados ×3 | `product-run-1/kuyfi-authz-ed25519-run-1-*.json` |
| Producto, Ed25519 on-chain | idem | `matrix-ed25519-onchain.json` `8af3dc8a…` | idem | ED-1-onchain 1/1 (L5331117) | `…ed25519-onchain-run-1-20261022T142618Z.json` |
| Producto, cuenta personalizada sim | `fe162a5` (commit 11:30:02; corridas desde 11:30:29) | `matrix-custom.json` `91051c21…`; escrito 11:30:04 | Vault `CBQTLVR6…`, Policy `CBZHNF3A…` | 5/5 ×3 | `…custom-account-run-1-*.json` |
| Producto, custom on-chain | `fe162a5` | `matrix-custom-onchain.json` `1c7a9c29…` | idem | CA-1, CA-3 (L5331204/L5331209) | `…custom-onchain-run-1-20261022T143409Z.json` |
| Producto, anidada sim | `fe162a5` | `matrix-nested.json` `810cc638…`; escrito 11:30:04 | nested v2: Executor `CCCHYWWO…`, Router `CB5VTCZS…` | 4/4 ×3 (un 4.º intento sin archivo, ver §3) | `…nested-run-1-*.json` |
| Producto, anidada on-chain | `fe162a5` | `matrix-nested-onchain.json` `9a84e68a…` | idem | NA-1 (L5331216) | `…nested-onchain-run-1-20261022T143442Z.json` |
| Ensayo con despliegue limpio (`demo.sh authz-product`, `demo-20261022-1138`) | `d4efd21` (el código de `source/` no cambió entre `fe162a5` y `062dc4d`) | mismas matrices regeneradas con los IDs del nuevo despliegue | Vault `CCZYSPZW…`, Policy `CBU5XT74…` | Ed25519 7/7, custom 5/5, ED-1 on-chain (L5331290); **sin matriz anidada** | `evidence/demo-20261022-1138/` |

Las corridas Ed25519 del producto son el hueco de trazabilidad: el resultado es el esperado y reproducible (3/3), pero no se puede probar qué commit exacto las ejecutó. No se repiten solo por eso (§4).

## 3. Los 16 casos del producto frente a los 12 compromisos
Los **12 compromisos** (TA7): ED-1…5, CA-1…4, NA-1…3. Los controles pareados que añade el diseño **no aumentan** esa cifra.

| Matriz del producto | Casos ejecutados | Compromisos que cubre | Controles adicionales (no cuentan) |
|---|---|---|---|
| Ed25519 (7) | ED-1, ED-2, ED-3, ED-4, ED-5 | **ED-1…ED-5** (5/5) | `ED-3b` (firma de otra clave, variante de ED-3), `C-ED5` (control de ED-5: admin legítimo) |
| Cuenta personalizada (5) | CA-1, CA-2, CA-3, CA-4 | **CA-1…CA-4** (4/4) | `CA-4b` (código de política #11, exploratorio) |
| Anidada (4) | NA-1, NA-2, NA-3 | **NA-1…NA-3** (3/3) | `C-NA3` (control: hijo firmado para 6 con llamada con 6 → éxito) |
| On-chain (4 casos en 3 matrices) | ED-1, CA-1, CA-3, NA-1 | las 4 evidencias on-chain comprometidas | — |

12 compromisos = 5 + 4 + 3. Los otros 4 casos de las tres matrices de simulación (ED-3b, C-ED5, CA-4b, C-NA3) son controles/variantes.

### Criterios ya respaldados (con el alcance de §1)
- Simulación enforcing explícita ×3 consecutivas con diagnósticos guardados: 12/12 compromisos (spike run-0, spike run-1, producto).
- Atribución del rechazo con control pareado en simulación: ED-2…5, CA-2, CA-4, NA-2, NA-3.
- NA-2/NA-3: texto idéntico; la atribución es por diseño de variable única + C-NA3 (documentado).
- On-chain: ED-1, CA-1, CA-3, NA-1 en run-0, run-1 y producto.
- Separación relay/actor, nonce CSPRNG, `enforce` explícito, bloqueo de envío en simulate-only: probados con pruebas automáticas independientes del ejecutor.

### Intento anidado sin archivo
Un intento adicional de `kuyfi authz` sobre la matriz anidada (entre las 14:30 y 14:35 UTC) **no produjo archivo de evidencia y su error no se capturó**. Queda como **intento sin resultado recuperable**. No se sabe por qué terminó: no se atribuye a un fallo transitorio. (El aborto del primer `nested.mjs` del spike sí se observó como error TLS/socket; es otro evento.) El resultado de la matriz anidada descansa en las 3 corridas que sí tienen archivo.

## 4. ¿Hace falta una corrida independiente?
**Sí, una**, y es la ya planificada, no una repetición general:
- **Cuál:** la corrida definitiva de los 12 compromisos con el producto, en un despliegue **nuevo** (otros Contract IDs), matrices con SHA-256 fijado y **commit del producto fijado** (árbol limpio, `dist` construido desde él), incluyendo la anidada y las 4 evidencias on-chain.
- **Qué incertidumbre resuelve:** (a) que las expectativas funcionen en un despliegue que ni el spike ni el producto vieron; (b) el SHA de las corridas Ed25519 no registrado; (c) que la matriz anidada tenga también un ensayo en despliegue limpio (el `demo.sh` no la incluye).
- **Qué no hace falta repetir:** las corridas de run-0/run-1 ni las del producto; sus archivos se conservan. **No se ejecuta ahora**: la integración todavía tiene pendiente el despliegue reproducible de las fixtures desde el repositorio, y la corrida definitiva debe usarlo.

## 5. Registro útil ante ejecuciones fallidas (cambio de producto, `d65f4f1`)
- El JSON de evidencia incluye ahora `matrix: {file, sha256}` (hash del archivo leído).
- Un intento que falla (matriz inválida, error de ejecución) escribe `kuyfi-authz-failure-<id|unloaded>-<ts>.json` (`wx`, sin sobrescribir) con `phase` (`load`|`run`), versión de la herramienta, nombre y SHA de la matriz, y el mensaje de error **con cualquier cadena con forma de semilla secreta `S…` redactada**. Declara que no es evidencia de prueba. Si el registro no puede escribirse, el error se informa igual.
- Pruebas: registro con fase, hash y sin secretos; fallo previo a cargar; registro no escribible; hash en la evidencia correcta.
- El SHA del commit sigue sin poder obtenerse desde el paquete distribuido (no hay git): lo fija el operador en el registro de la corrida (registro interno de ejecución, no publicado).
