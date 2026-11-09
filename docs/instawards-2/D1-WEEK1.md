# D1 — Avance de la semana 1 (baseline, fixtures y base funcional)

Fechas: 2026-10-21 (bloque 1) y actualización del mismo día (bloque 2: S1/S2, configuración, procedencia, límites). Rama `instawards-2/week-1`. **No** declara D1 cumplido: faltan campañas reales, S1/S2 y la comparación de tres brazos.

## 1. Baseline publicado (brazo A) — `@kuyfi/kuyfi@0.1.0`

- `npm view @kuyfi/kuyfi@0.1.0 gitHead` = `e8019b20597c50ed520f87163252095060d57cde` (coincide con el commit declarado en la v8). Instalado en un directorio aparte (fuera del repo); la versión publicada no se modificó.
- Hallazgo operativo: **v0.1.0 no tiene modo simulate-only; difunde transacciones** (16 de 16 vectores en la fixture de control). Por eso el brazo A solo se ejecutó sobre fixtures propias; **no** se ejecutará contra contratos reales sin registro de autorización por campaña.

### Control vulnerable/protegido (fixture propia `broken_access_control`)

| Dato | Valor |
|---|---|
| Contract ID (Testnet) | `<CONTRACT_ID_1>` |
| WASM hash | `a57dffb8f6614aa63f5dc74286c7e11befc0fd454153587216309534d60ce901` |
| Despliegue | `test-fixtures/baseline-evidence/control/deployment.json` (2026-10-21) |

| Corrida (arm A) | reportId | Vectores / broadcast | Hallazgos |
|---|---|---|---|
| 1 | `kyf-20261021T135947Z-36b4d904` | 16 / 16 | `set_admin_value::UNAUTHORIZED_CALL` CRITICAL |
| 2 | `kyf-20261021T140217Z-f594c140` | 16 / 16 | idem |
| 3 | `kyf-20261021T140433Z-94a4dcf2` | 16 / 15 | idem **+** `set_admin_value::admin::RANDOM_ADDR_B` `UNEXPECTED_ERROR` MEDIUM (`SEND_ERROR`: "Network rejected transaction before broadcast") |

- Función protegida `secure_set_admin_value`: **0 hallazgos en 3/3** corridas. Función vulnerable: hallazgo CRITICAL en **3/3**.
- La corrida 3 es variabilidad operacional (rechazo de red), no semántica; se informa tal cual y es un ejemplo de por qué A se repite.
- Un primer intento de tres corridas falló por `ETIMEDOUT` hacia el RPC (v0.1.0 no reintenta; exit 1, sin reporte). Se repitió completo; los intentos fallidos no se cuentan.
- Reportes: `test-fixtures/baseline-evidence/control/armA-v0.1.0/run{1,2,3}.json` y `summary.json`.

### Smoke del build del sprint sin contexto (brazo B), 1 corrida

`kyf-20261021T141052Z-21287d77`: 16 vectores / 16 broadcast, 1 CRITICAL solo en `set_admin_value`. Es una verificación de compatibilidad, **no** las 3 corridas formales de B. Archivo: `…/armB-sprint-build-smoke/run1.json`. Este reporte no incluye aún campos de procedencia (no están en el JSON).

### Pendiente del baseline
Tres contratos reales (Contrato B y Contrato C sin Contract ID; Contrato A sin re-verificar con el escáner de KUYFI), baseline de las fixtures S1/S2 y 3 corridas de B y C. Sin registros de autorización, esas campañas son solo simulación y v0.1.0 **no puede** ejecutarse sobre ellas.

## 2. Fixtures controladas S1 y S2 (construidas y desplegadas en el bloque 2)

Ambas **sin** `require_auth`; el observable es independiente de la autorización. Se elegirán formalmente el día 5 tras revisar los baselines (decisión de Alex); estas son las candidatas.

### S1 — condición de rol almacenado (`RoleGate`)
- `init(operator: Address)` guarda el rol. `privileged_set(caller: Address, value: i128)`: si `caller != operator` → `Error(Contract, #1)` (`NotOperator`); si coincide, guarda `value` y emite el evento `role_ok` **después** del chequeo.
- Precondición de la campaña: el `operator` es un valor conocido. Con contexto: `roles.caller = <operator>`.
- Observable: evento `role_ok` (o éxito de la llamada). Evidencia: simulación; on-chain si hay broadcast.
- Hipótesis (no presunción): sin contexto (A, B) el parámetro `caller` recibe una dirección aleatoria y la llamada falla en `NotOperator`; con contexto (C) alcanza el observable 3/3. Se documenta la diferencia observada sea cual sea.

### S2 — condición de referencia a contrato (`HookCaller` + `PingTarget`)
- `PingTarget.ping() -> u32` (devuelve una constante). `HookCaller.call_hook(target: Address)`: invoca `target.ping()` y **después** emite `hook_ok`. Un `target` que no es contrato o no expone `ping` falla en la llamada.
- Con contexto: `knownValues.target = {type: address, value: <PingTarget>}`.
- Observable: evento `hook_ok` posterior a la llamada al contrato referenciado.

Si un escenario no se puede observar con estas fixtures, se reemplaza antes del día 7 y se registra el motivo (TA7 §2).

## 3. Primera parte funcional (código)

Módulos nuevos en `source/modules/chaos_monkey/`:

| Archivo | Función |
|---|---|
| `context_config.ts` | `ContextConfig` (`version: 1`, `roles`, `knownValues` tipados), `parseContextConfig` estricto (claves desconocidas, direcciones, tipos y versión; lista todos los problemas), `resolveContextValue` (coincidencia por nombre de parámetro sin distinguir mayúsculas y por tipo del spec), `unusedContextKeys` (detecta claves que nunca coincidieron) |
| `provenance.ts` | `InputProvenance` (`param`, `rule`, `source` ∈ spec / type_boundary / configured_context / test_data, `configKey`, `seeded`), `provenanceCoverage` (chequeo automático: una entrada por parámetro de cada invocación) |
| `input_builder.ts` | `buildBaselineInput`, `buildAttackInputs`, `injectedInput`: envuelven `baseline()`/`attackVals()` añadiendo procedencia; con contexto sustituyen el baseline por el valor configurado |

Cableado: `ChaosMonkeyOptions.context?` → `fuzzMathVectors` y `fuzzAccessVectors` (parámetro opcional). `FuzzResult.inputs?` lleva la procedencia de cada argumento. **Sin `context` el flujo es el de v0.1.0** (misma lista de vectores y nombres; los valores aleatorios siguen siendo aleatorios).

Tests nuevos: 11 (`context_config.test.ts`): validación, resolución por rol/valor conocido, sin coincidencia por tipo distinto, claves sin usar, procedencia con y sin contexto, UDT irresoluble → `null`, cada vector de ataque con procedencia, `provenanceCoverage` detecta faltantes.

### Lo que NO está hecho (no contar como avance de aceptación)
- **Procedencia en 3 de 5 familias de fuzzers pendiente**: `fuzzer_fee`, `fuzzer_liquidity` y `fuzzer_call_order` aún usan `baseline()` directamente; sus invocaciones no llevan procedencia, así que `provenanceCoverage` hoy **no** daría 100 %. La cifra de aceptación (100 %) sigue sin demostrarse.
- La procedencia **no está en el JSON/PDF** ni existe archivo de configuración/CLI para pasar `context` (llega con D3). Hoy solo se usa por API.
- Límites por campaña (funciones, familias, máx. vectores, simulate-only / broadcast) no implementados.
- Semilla (D3): los valores aleatorios no son reproducibles; `seeded` es siempre `false`.
- El vocabulario de fuentes usa `test_data` + `seeded` en lugar de `seeded_test_data` (TA7 §2) porque aún no hay semilla; se alinea con la semilla.

## 4. Bloque 2 (2026-10-21): S1/S2, baseline y comparación A/B/C

### Fixtures desplegadas (Testnet, `test-fixtures/context-fixtures/`, despliegue `baseline-evidence/context-fixtures/deployment.json`, 2026-10-21T14:25Z)

| Fixture | Contract ID | WASM hash |
|---|---|---|
| S1 `RoleGate` | `<CONTRACT_ID_S1>` | `635a2c100c269709375663bd3442aa5d4cfd3ce950c3e6c9e7fd70bf3fd43700` |
| S2 `PingTarget` | `<CONTRACT_ID_S2_PING_TARGET>` | `637f2adb91323cc32466b6704ae498224f116b3f7bd7d44f979c53ff2f321342` |
| S2 `HookCaller` | `<CONTRACT_ID_S2_HOOK_CALLER>` | `6e88e869944b0e2f5ee39db612a120b645b54f2d8bb974cfc2265ab09b22644d` |

Sin `require_auth` en ninguna. Operador de S1: `GAUP4V3M…XSP` (nunca firma). Precondiciones verificadas en solo lectura antes de cada corrida (`get_operator` = operador; `ping()` = 42). Observable = evento `role_ok`/`hook_ok` contado con `getEvents` desde `startLedger + 1`.

### Resultado (tabla completa en `test-fixtures/baseline-evidence/context-fixtures/COMPARISON.md`)

| | A: v0.1.0 | B: sprint, sin contexto | C: sprint, con contexto |
|---|---|---|---|
| S1 observable `role_ok` (3 corridas) | 0, 0, 0 (14 vectores, 0 difundidos) | 0, 0, 0 (14, 0) | **6, 6, 6** (14, 6 difundidos) |
| S2 observable `hook_ok` (3 corridas) | 0, 0, 0 (3, 0) | 0, 0, 0 (3, 0) | **1, 1, 1** (3, 1) |
| Hallazgos | 0 | 0 | 1 por escenario: `UNAUTHORIZED_ADDR_CALL` POTENTIAL_VULN HIGH |

- Con contexto, el observable se alcanza **3/3 en S1 y 3/3 en S2** (criterio de D1); la diferencia respecto de A y B es que sin contexto todos los vectores se rechazan en simulación con valores aleatorios (0 difundidos). Es una observación en dos fixtures propias, no una medida de efectividad.
- El hallazgo del brazo C es genuino pero **consecuencia del diseño de la fixture** (sin `require_auth`, la llamada con una dirección que no firma tiene éxito): no es una vulnerabilidad atribuible al contexto.
- A y B coinciden por construcción del escenario; **A no se presumió fallido** y se conservó su resultado.
- Una pérdida operativa: S1/C corrida 3, `caller::RANDOM_ADDR_A` → HTTP 502 del RPC (`OPERATIONAL_ERROR`, en `coverage.operationalErrors`). No afecta el criterio.

### Identificación del código ejecutado
- Brazo A: `@kuyfi/kuyfi@0.1.0`, `gitHead` `e8019b2…` (en cada `result.json`).
- Brazos B/C S1/S2 (formales): commit `b87692a` (árbol sin cambios sucios en `source/`; el código de `source/` es idéntico al de `50e5512`). El reintento de `txBadSeq` (abajo) se añadió **después** (`abcb6a4`); estas corridas no lo incluyen y no tuvieron `txBadSeq`.
- Control (formal): `abcb6a4`. Control previo al reintento: `control/armB-sprint-pre-retry-b87692a/` (conservado).
- Corridas de humo (no formales): `S1/armC-smoke`, `S1/armC-simulate-only-smoke`, `control/armB-sprint-build-smoke`.
- Un primer lote de brazo A se solapó con otro y se **descartó** (corridas concurrentes sobre las mismas fixtures); se repitió con bloqueo anti-concurrencia.
- Corrección de medición: `getEvents.endLedger` es exclusivo y las ventanas de corridas consecutivas compartían un ledger. Los conteos se recalcularon sobre las mismas ventanas (valor original en `observableEventsFirstPass`, `recount_events.mjs`).

### Control vulnerable/protegido con el build del sprint (3 corridas, `abcb6a4`)
Hallazgo CRITICAL `set_admin_value::UNAUTHORIZED_CALL` en **3/3**; `secure_set_admin_value` sin hallazgos en 3/3; 0 errores operativos; procedencia 100 %. Con el build anterior al reintento (`b87692a`) la corrida 1 no produjo el hallazgo porque el vector fue rechazado con `txBadSeq` (ver §5); se investigó, corrigió y repitió (la corrección es lo que exige el criterio).

## 5. SEND_ERROR (v0.1.0, corrida 3 del control)

- **Reporte histórico intacto** (`control/armA-v0.1.0/run3.json`).
- **Causa en v0.1.0:** `parseInvokeResult` no tenía rama para `SEND_ERROR`; caía en el fallback de `classifyError` → `UNEXPECTED_ERROR` → MEDIUM → entraba a `findings`. El router de v0.1.0 además descartaba el motivo del rechazo, de modo que la causa de ESA corrida no es recuperable; la corrida 1 del control con el sprint mostró `txBadSeq` en el mismo punto (primera vez que se conservó el motivo), por lo que `txBadSeq` es la causa probable, no demostrada, del caso histórico.
- **Efecto en la comparación:** el MEDIUM de la corrida 3 de A es ruido operacional; se compara por (vector, clasificación), no por conteo, y se informa tal cual.
- **Nueva implementación:** `SEND_ERROR`, `EXCEPTION` y `BUDGET_EXHAUSTED` → `OPERATIONAL_ERROR` (INFO, fuera de `findings`, contado en `coverage.operationalErrors` y en `vectorsExecuted`); el motivo (`txBadSeq`, etc.) se conserva en el mensaje; `txBadSeq` se reintenta (máx. 2, con espera) y los reintentos se informan. Pruebas de regresión: `operational_error.test.ts`.
- No se eliminó ningún resultado: los errores operativos siguen visibles. Quedó un riesgo: un vector con error operativo no se evalúa, así que un hallazgo real podría quedar sin comprobar (lo muestra el bloque de cobertura y `--fail-on-incomplete` de D3 debe cubrirlo).

## 6. Configuración, procedencia, límites (implementado)

- `--config <archivo.json>` (`campaign.ts`): `version`, `target`, `context {roles, knownValues}`, `limits {functions, families, maxVectors, mode}`, `authorizationRecord`. Validación estricta (claves desconocidas, tipos). **Sin `limits.mode` la campaña es simulate-only; `broadcast` exige `authorizationRecord`.** Sin `--config`, comportamiento de v0.1.0 (difunde). Un archivo inválido o con `target` distinto es fallo de herramienta (exit 1) antes de cualquier red.
- Límites aplicados en `CampaignServer`, el `server` que reciben todos los fuzzers: `maxVectors` se comprueba en `invokeContract` antes de cualquier llamada; en simulate-only `sendTransaction` lanza `SimulateOnlyViolation` para cualquier llamador (prueba de elusión). Funciones/familias filtran la planificación. Verificado en corrida real: simulate-only sobre S1 → 14 vectores, 0 difundidos, 0 eventos, `blockedSends` 0.
- **Hallazgo semántico:** la simulación sin `authMode` es *recording* y `enforce` sin entradas no replica una transacción difundida (§D2), así que en simulate-only los vectores de acceso exitosos se clasifican `NOT_EVALUATED` (hueco de cobertura), no POTENTIAL_VULN.
- Procedencia en los 5 fuzzers. **Cobertura (cómo se calcula el 100 %):** denominador = toda invocación ejecutada (difundida o simulada, incluidos errores operativos; excluidas las rechazadas por presupuesto); numerador = invocaciones con exactamente una entrada válida por parámetro, en orden, con `param`, `rule`, `source`, `seeded` y `configKey` si y solo si `configured_context`. La definición se escribe en el JSON (`provenance.audit.definition`). Resultado: 100 % en los 12 reportes S1/S2 B/C y en el control; prueba que lo verifica en las 5 familias con y sin contexto. Una invocación sin procedencia baja el porcentaje (prueba).
- JSON aditivo (`schemaVersion` sigue 1.0.0): `provenance`, `coverage`, `campaign`. No contiene valores de contexto ni claves (prueba que busca el valor configurado en el JSON). **PDF:** la postulación exige solo el JSON para procedencia y cobertura (TA7 §6, "additive fields" de JSON); el PDF existente no cambia y no se añadió trabajo de presentación. Los nuevos tipos de señal no aparecen en `findings`, que es lo que el PDF lista.
- Tests: 191 (163 → 191): validación de configuración, aplicación real de límites vía `runChaosMonkey` con servidor falso (sin red), simulate-only, presupuesto, listas permitidas, procedencia 100 % en 5 familias, regresión de `SEND_ERROR`/`txBadSeq`, exportación JSON, CLI (`--config` inválido, `target` distinto, ruta sin `--config`).

### Aún no hecho en D1
Campañas sobre los tres contratos reales (Contrato A re-verificado; sin registro de autorización; Contrato B/Contrato C pendientes); semilla (D3); `--fail-on*` (D3); el esquema de configuración aún no cubre `seed`; el TUI ignora `--config`; el comando de la TUI y el modo interactivo no se tocaron.

## 7. Revisión del 2026-10-21 (tarde): procedencia, HIGH y S1/S2

### 7.1 S1 y S2 frente a la postulación enviada (v8 / TA7 §2)
Decisión de Alex: S1 y S2 son los escenarios definitivos si cumplen. Contraste:

| Exigencia | Fixture / resultado | ¿Cumple? |
|---|---|---|
| Función sin requisito de autorización | `RoleGate.privileged_set` y `HookCaller.call_hook` no llaman `require_auth` | Sí |
| S1: condición de rol almacenado; observable = evento tras el chequeo o éxito | `NotOperator` salvo `caller == operator`; evento `role_ok` | Sí |
| S2: condición de referencia a contrato; observable = evento tras la llamada al contrato referenciado | `call_hook(target)` invoca `target.ping()`, luego `hook_ok` | Sí |
| Elegidos el día 5 tras revisar baselines | Baselines de A revisadas el 2026-10-21 (día 3) | Sí (antes del plazo) |
| Tres brazos A/B/C; A repetido 3 veces | A, B y C × 3 en cada escenario | Sí |
| C alcanza el observable en 3/3 | S1 6/6/6, S2 1/1/1 | Sí |
| Evidencia: simulación, más on-chain si hay broadcast | El observable se mide con eventos de transacciones incluidas; la simulación se usó para las precondiciones | Sí |

**Sin diferencia material** respecto de lo comprometido. Matiz que no cambia el compromiso: el observable se mide sobre transacciones difundidas a fixtures propias; en simulate-only la misma campaña no alcanza el observable porque no emite eventos (ver §6).

### 7.2 Qué afirman los HIGH de S1/S2 (`UNAUTHORIZED_ADDR_CALL`)
- **Qué produce el vector:** llama una función con una dirección sin relación en su ranura de `Address`, firmada solo por la clave efímera. Si la llamada **tiene éxito**, la clasificación es `POTENTIAL_VULN` (HIGH para no administrativas, CRITICAL para funciones con nombre administrativo).
- **Qué demuestra:** que *esa llamada tuvo éxito sin que la dirección autorizara nada*. Eso es una observación verificable (transacción incluida, hash y ledger).
- **Qué NO demuestra:** que la función *debía* exigir autorización. En caja negra no se conoce la política prevista. S1/S2 se diseñaron **sin** `require_auth` (lo exige D1 para no mezclar con D2), así que el hallazgo es consecuencia del diseño de la fixture, no una vulnerabilidad confirmada. En el control, la señal es significativa porque la contraparte protegida (`secure_set_admin_value`) rechaza la misma llamada; aun así se redacta como posible hueco.
- **Corrección acotada (commit `dd485e0`):** el texto de `details` decía "access control bypass — call was NOT rejected". Ahora dice que la llamada tuvo éxito sin autorización de las direcciones argumento, que es un posible hueco de control de acceso y que debe confirmarse con la política prevista. **Señal y severidad no cambian**, por lo que la tabla A/B/C y el criterio del control (misma señal y clase de severidad que el sprint 1) no se ven afectados. Prueba de regresión en `operational_error.test.ts`.
- Los reportes originales se conservan con el texto anterior (generados antes del cambio). Documentos históricos (`docs/demo.md`, `docs/technical-writeup.md`) citan el texto de v0.1.0 y no se modificaron.

### 7.3 Cobertura de procedencia: población y casos especiales (diseño real)
Corrección hecha (commit `dd485e0`) tras revisar la métrica: antes se auditaban solo las invocaciones ejecutadas, y un parámetro compuesto con `Address` anidada se etiquetaba `spec` aunque el generador pone direcciones aleatorias dentro.

| Categoría | Tratamiento |
|---|---|
| **Vectores generados** (población auditada) | ejecutados + rechazados por presupuesto de vectores |
| Ejecutados | los que llegaron a simularse/difundirse (incluye los que acabaron en error operativo) |
| Rechazados por presupuesto | se generaron las entradas pero no se inició la llamada; **se auditan** (`refusedInvocations`) y aparecen en `provenance.audit.vectorsRefusedByBudget` |
| Fallidos por problema operativo | cuentan como ejecutados; su número está en `executedWithOperationalFailure` y su detalle en `coverage.operationalErrors` |
| Omitidos por límites (funciones/familias) | no se generan entradas → fuera de la población; se listan en `campaign.functionsSkippedByLimit` |
| Funciones sin tipos resolubles / sin parámetros | no se generan entradas → fuera de la población; aparecen en `coverage.functionsWithZeroInvocations` (las funciones sin parámetros no reciben vectores) |
| Parámetro compuesto (struct, vec, map, option, tuple, result) | **una** entrada por parámetro; `source = test_data` si alguna hoja es `Address` generada; `nested` lista las fuentes de las hojas |
| Baseline reutilizado entre vectores | se registra una vez por vector que lo usa |
| Valor transformado | el contexto reemplaza solo parámetros **escalares** (por nombre y tipo); nunca campos anidados. Los vectores de ataque son tipo-frontera y no transforman un valor de contexto |

Evidencia: pruebas de struct/Vec/Option con `Address`, Vec<u32>, ciclo en UDT, contexto que no reemplaza anidados, y una campaña con presupuesto que audita los vectores rechazados (100 %, generados = ejecutados + rechazados). Los reportes ya guardados contienen solo parámetros escalares (`Address`, `i128`), por lo que su 100 % sigue siendo válido sin repetir campañas; el JSON antiguo no lleva `nested` ni los contadores nuevos.

### 7.4 Pendiente registrado (2026-10-22): severidad de `UNAUTHORIZED_ADDR_CALL`
Una función pública accesible no demuestra por sí sola una vulnerabilidad. La severidad HIGH (CRITICAL si el nombre es administrativo) sale de la señal `POTENTIAL_VULN`; **está pendiente justificar si mantener HIGH** en estos casos. Hasta entonces los HIGH de S1/S2 se describen como observaciones derivadas del diseño de fixtures sin `require_auth`, **no como vulnerabilidades confirmadas**. Mismo tipo de pregunta para `UNEXPECTED_ERROR` (MEDIUM, "inconcluso") visto en A-1 (el registro interno de la campaña A-1 (no publicado)). No se cambió ninguna severidad ni se eliminó ningún resultado.
