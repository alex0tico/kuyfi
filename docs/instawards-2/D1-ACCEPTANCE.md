# D1 — Tabla de aceptación (evaluada 2026-10-22; versión pública revisada 2026-10-24)

> **Versión pública.** Los informes completos, Contract IDs, hashes WASM, nombres de funciones y transacciones de los tres contratos de colaboradores se conservan **solo en local** por decisión del autor (los colaboradores autorizaron probar y divulgar resultados, pero no se publican identificadores recuperables). Aquí solo hay agregados verificables en `test-fixtures/baseline-evidence/real-contracts-aggregate/aggregate.json`.

Criterios exactos de `application-v8.md` (D1, "Acceptance" y "Planned evidence") y, para las campañas reales, de TA7 §2. Una sola tabla; se reutilizan resultados existentes. "Cumplido" = el criterio escrito se cumple; no implica cobertura más allá de lo que dice la columna de límites.

## Veredicto
**Los tres criterios de aceptación de v8 (S1/S2 3/3, procedencia 100 %, control 3/3) están cumplidos con evidencia en el repo local.** Las campañas en los tres contratos reales están **ejecutadas** (simulate-only) con registro, límites, procedencia y clasificación de vectores bloqueados. D1 **no puede declararse completo en su totalidad** por cuatro pendientes mínimos, ninguno de código (ver el final).

## Tabla

| # | Criterio (texto de la postulación) | Estado | Evidencia | Límites / qué no demuestra |
|---|---|---|---|---|
| 1 | Configuración contextual (roles, valores conocidos) | **Cumplido** | `--config`, `context_config.ts`; ejemplos `context-fixtures/configs/*.json`; en una campaña real se usó `roles.actor` (`contextKeysUsed` lo confirma en el informe local) | contexto solo reemplaza parámetros escalares |
| 2 | Límites por campaña (funciones, familias, máx. vectores, simulate-only o broadcast) | **Cumplido** | `CampaignServer` (bloquea `sendTransaction` y aplica `maxVectors` antes de la red); pruebas `campaign*.test.ts`; `campaign.blockedSends = 0` en las tres campañas reales; `broadcast` exige registro | — |
| 3 | Procedencia en el 100 % de los inputs generados | **Cumplido** | `provenance.audit.percent = 100`: S1/S2 (A/B/C), control, Contrato A 64/64, Contrato B 32/32, Contrato C 69/69 | población = vectores generados (definición en el JSON); parámetros compuestos = 1 entrada |
| 4 | S1 y S2: observable alcanzado 3/3 con contexto; diferencia documentada; comparación A/B/C (v0.1.0, sprint sin contexto, con contexto; A repetida 3×) | **Cumplido** | `context-fixtures/COMPARISON.md`: A 0, B 0, C 6/corrida (S1) y 1/corrida (S2); 3 corridas por brazo | dos fixtures propias; observación, no medida de efectividad. Los HIGH de C son hipótesis de fixtures sin `require_auth` |
| 5 | Control vulnerable/protegido: hallazgo en la vulnerable y ninguno en la protegida, 3/3 (regresión corregida y re-probada) | **Cumplido** | `control/armB-sprint` 3/3 (build `abcb6a4`); regresión `txBadSeq` corregida y repetida; corrida previa conservada | — |
| 6 | Campañas en **tres** contratos reales Testnet distintos de las fixtures | **Ejecutadas 3/3, simulate-only** (cobertura limitada, ver §resultados) | agregados por campaña en `real-contracts-aggregate/aggregate.json` (informes completos: solo locales) | ninguna campaña envió transacciones; no se afirma cobertura de la lógica de negocio |
| 7 | Registro de autorización por campaña (funciones, familias, permiso de cambios de estado, límites); sin registro = simulate-only | **Cumplido en forma; parcial en fondo** | registros `A-1`, `B-1`, `C-1` (solo locales) + `authorizationRecord` en cada config/informe local; permiso de cambios de estado: **no** | son confirmaciones del solicitante; TA7 §2 pide además propietario/contacto y ventana de fechas (**faltan**) |
| 8 | Por contrato real: Contract ID, hash WASM, versión | ID y hash **sí** (registrados en local); versión **no declarada** | verificación de solo lectura guardada en local; no se publican ID ni hash | los tres WASM solo traen metadatos de compilador (`rsver`, `rssdkver`), no versión de contrato; no se inventa |
| 9 | Clasificación explícita de cada vector bloqueado antes de la condición semántica (TA7 §2) | **Cumplido** desde `8e6851c` | `provenance.invocations[].outcome` y `signal` en las reejecuciones con el build `8e6851c` (conteos por categoría en el agregado) | la categoría es la del último error de la traza; el significado de un código de contrato se toma del enum de errores del propio contrato (spec, guardado en local) |
| 10 | Informes por brazo "donde aplique" (TA7) | **No aplicable** a contratos reales | — | v0.1.0 difunde transacciones y no garantiza simulate-only; no se ejecutó; **no** es una excepción aprobada por Instawards |
| 11 | Evidencia planificada: cambios *merged*, ejemplos de configuración, JSON baseline y sprint, IDs y hashes, registros, documento de comparación | **Parcial** | configuración, JSON, IDs/hashes, registros y `COMPARISON.md`: en el repo local | los cambios están en la rama local `instawards-2/week-1`, **no mergeados ni publicados** |

## Resultados de las campañas reales (por lo observado, no por haberse ejecutado)
Reejecuciones con el build `8e6851c` (los primeros informes se conservan; no los contradicen).

| Contrato | Vectores generados / ejecutados | Bloqueados (categoría y código) | Aceptados | Hallazgos | No evaluados |
|---|---|---|---|---|---|
| Contrato A | 64 / 64 | 24 por trampa genérica del host → **inconclusos** (distribuidos en 5 funciones) | 40 (34 `SECURE`, 6 `NOT_EVALUATED`) | 0 respaldados, 0 hipótesis, 24 inconclusos | 6 (acceso) |
| Contrato B | 32 / 32 | **32 de 32** rechazados por errores del propio contrato: 22 × error de validación #1 en una función y 10 × error de validación #4 en otra | 0 | 0 | 0 |
| Contrato C | 69 / 69 | 55 por errores del contrato: 36 × error de control de acceso (#9) en dos funciones (18 + 18); 19 × error de validación de formato de identificador (#1) en cinco funciones | 14 (12 `SECURE`, 2 `NOT_EVALUATED`) | 0 | 2 (funciones de acceso) |

**Contrato B y la lógica de negocio.** El significado de `Error(Contract, #4)` **ya no está sin confirmar**: el enum de errores del propio contrato lo declara (guardado en local). Lo observado: **ninguno de los 32 vectores pasó las validaciones de entrada**; por tanto no se alcanzó la lógica de negocio. Esto **no** impide ningún criterio de la tabla: D1 compromete ejecutar la campaña con registro, límites, procedencia y clasificación de lo bloqueado, no que la lógica de negocio se complete ni cubrir una función; no se añade ese requisito. La clasificación del criterio 9 es precisamente lo que deja la limitación explícita. Para ir más allá hacen falta datos externos (activos con ruta y un monto válido).

**Contrato C.** El control por rol se **alcanzó** en dos funciones (36 vectores): evidencia de que existe una condición semántica de rol evaluada antes de la validación posterior; no prueba que el control sea correcto. El resto de funciones con identificador quedó bloqueado por validación de formato del identificador porque no se conoce un identificador válido; no se inventó.

**`SECURE` en estos informes** significa "aceptado sin fallo o rechazado con un error de contrato/autorización confiable"; **no** significa "protegido". Ninguna campaña prueba seguridad.

## Pendientes mínimos de D1
| # | Pendiente | Tipo |
|---|---|---|
| P1 | Propietario/contacto independiente y ventana de fechas por campaña (TA7 §2); documento del colaborador si se quiere más que confirmación del solicitante | **dato externo** (Alex / colaboradores) |
| P2 | Merge o publicación de los cambios (criterio 11, "merged changes"): rama pública preparada `instawards-2/week-1-public`, **no publicada** (ver `PUBLICATION.md`) | **decisión/acción de Alex** (no es código) |
| P3 | Versión de los contratos (si los equipos la tienen) | **dato externo**, opcional: los WASM no la declaran |
| P4 | Contexto de estado para ir más allá del primer rechazo (Contrato B: parámetros de entrada válidos; Contrato C: entidad registrada; Contrato A: estado/roles) | **dato externo**, **no** es criterio de aceptación; sin él la cobertura queda como está |

Sin cambios de código pendientes para D1. Fuera del criterio: decisión MEDIUM/INFO de `UNEXPECTED_ERROR` (no bloquea).
