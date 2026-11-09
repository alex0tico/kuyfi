# Instawards 2 — Cierre de la semana 1 (hecho 2026-10-22; cierre operativo previsto viernes 23; versión pública preparada sábado 24)

**Fechas reales.** Sprint iniciado lunes 2026-10-19. Las tres campañas reales se ejecutaron el **2026-10-22** (UTC; A-1 14:36 y 21:40, B-1 15:45 y 21:40, C-1 21:38 y 21:41: primera ejecución y reejecución con el build `8e6851c`, que añade el resultado por vector). Decisión de D2: 2026-10-22. No hubo trabajo de cierre registrado el 23; la preparación de lo público es del 24. No se reinició el calendario.

Documento único de cierre (versión pública; el registro interno de ejecución no se publica). No cambia compromisos, horas ni presupuesto. Distingue tres niveles: **A. implementado y con evidencia local**, **B. material listo para mostrar**, **C. efectivamente publicado**. A la fecha de esta versión (2026-10-24) **C sigue vacío**: no hay push, release, paquete npm, grabación ni publicación en X.

## 0. Decisión de D2 (una sola, sin solicitudes duplicadas)
Alex decidió el **2026-10-22** continuar con el enfoque técnico de D2, sustentado en la evidencia documentada (`D2-REVIEW-FRIDAY.md`, sección de la decisión). Esa decisión **cierra la revisión de viabilidad**; no hay otra aprobación pendiente. Reconoce la viabilidad; **no** acepta los 12 casos. Limitaciones de trazabilidad conservadas (`D2-EVIDENCE-MAP.md`): la evidencia Ed25519 del producto no registra el commit exacto; el intento anidado sin archivo es un intento sin resultado recuperable de causa desconocida.

## 1. Compromisos de la semana 1

| Compromiso | A. Implementado / evidencia local | B. Listo para mostrar | C. Publicado |
|---|---|---|---|
| Sync de `main` y tag previo | Hecho (2026-10-21, tarde): tag `instawards-2-start` → `f360d8d` | — | no |
| Baseline v0.1.0 y reportes iniciales | Hecho para fixtures y control (3 corridas por brazo) | `demo.sh d1-stored` | no |
| Elección S1/S2 | Hecho (decisión de Alex) | idem | no |
| Configuración, límites, procedencia | Hecho; procedencia 100 % en fixtures, control y las tres campañas reales | `demo.sh d1-stored`, `cat …/S1-C-simulate.json` | no |
| S1/S2 comparación A/B/C | Hecho: C 6 (S1) y 1 (S2) en 3/3; A y B 0 | `demo.sh d1-stored` | no |
| Control vulnerable/protegido | Hecho 3/3 | `D1-ACCEPTANCE.md` | no |
| Campañas en tres contratos reales | **Ejecutadas 3/3, simulate-only** (A-1, B-1, C-1); cobertura limitada | `demo.sh real-stored` (solo agregados) | no |
| Registros de autorización | Hechos como confirmación del solicitante, solo simulación | registros locales | no |
| Experimento enforcing D2 | Hecho como viabilidad; decisión de continuar (§0) | `D2-REVIEW-FRIDAY.md` | no |
| D2 en el producto (adelantado) | `kuyfi authz` Ed25519 / cuenta personalizada / anidada; validación sobre run-1; registro de intentos fallidos | `demo.sh authz-stored` | no |
| Estado de hallazgos | Hecho (`FINDING-STATUS.md`); hipótesis e inconclusos presentados como tales | `demo.sh real-stored` | no |
| Demo | Guion de 3–4 min probado en lectura (`DEMO.md`) | listo para grabar | **no grabada** |

## 2. D1 — veredicto
Ver `D1-ACCEPTANCE.md` (tabla única). Criterios de aceptación de v8 (S1/S2 3/3, procedencia 100 %, control 3/3): **cumplidos**. Campañas en los tres contratos: **ejecutadas** con registro, límites, procedencia y clasificación de vectores bloqueados. Pendientes mínimos, **ninguno de código**: P1 propietario/contacto y ventana de fechas (dato externo); P2 merge/publicación de los cambios (acción de Alex); P3 versión de los contratos (dato externo, opcional: los WASM no la declaran); P4 contexto de estado para ir más allá del primer rechazo (dato externo, **no** criterio). La limitación del Contrato B (ningún vector pasó las validaciones de entrada) no impide ningún criterio comprometido.

## 3. Campañas reales (resultado por lo observado)
| Contrato | Vectores | Bloqueados | Hallazgos | Lectura |
|---|---|---|---|---|
| Contrato A | 64 | 24 trampas genéricas del host | 24 inconclusos, 0 hipótesis, 0 respaldados; 6 no evaluados | sin contexto de estado |
| Contrato B | 32 | 32/32 por dos errores de validación (22 y 10) del propio contrato | 0 | no se alcanzó la lógica de negocio |
| Contrato C | 69 | 55 (36 por control de acceso en dos funciones; 19 por validación de formato de identificador) | 0; 2 no evaluados | se alcanzó el control de rol; no la lógica dependiente de estado |

Ninguna campaña envió transacciones. 0 hallazgos no es seguridad. v0.1.0 no se ejecutó sobre terceros (no garantiza simulate-only); eso no es una excepción aprobada por Instawards.

## 4. Pendientes que no bloquean el cierre
- Decisión MEDIUM/INFO de `UNEXPECTED_ERROR` (hoy `inconclusive`, MEDIUM como prioridad): no bloquea.
- Semana 2: corrida definitiva de D2 (12 casos, despliegue limpio y reproducible, commit y matrices fijados), borde ED-4, campañas con contexto si hay datos.
- Semana 3: D3 (semilla, `--fail-on`, `--fail-on-incomplete`; diseño de consumo en `FINDING-STATUS.md`). Semana 4: repo CI, cinco campañas externas, cierre.

## 5. Publicación
Preparada pero **no ejecutada**. Destino, contenido, revisión y relación entre el código probado y el publicable: [`PUBLICATION.md`](PUBLICATION.md).
