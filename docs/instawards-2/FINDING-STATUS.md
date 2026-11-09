# Estado de los hallazgos: respaldados, hipótesis e inconclusos (2026-10-22)

## Problema
La taxonomía v0.1.0 mezclaba tres cosas en un solo campo `severity`: un hecho observado, una hipótesis que depende de una política que KUYFI no ve, y un resultado inconcluso. Un `UNAUTHORIZED_ADDR_CALL` que "tuvo éxito" salía como HIGH y un `UNEXPECTED_ERROR` salía como MEDIUM, y los resúmenes los contaban junto a defectos demostrados. Una llamada permitida no demuestra acceso indebido salvo que se conozca la política que la prohíbe; un error inesperado tampoco demuestra una vulnerabilidad.

## Corrección mínima (código `339e035`, aditiva)
Cada hallazgo lleva `status` (campo nuevo, opcional en el esquema 1.0.0, que **no cambia de versión**) y los resúmenes cuentan por estado.

| `status` | Qué establece | Señales |
|---|---|---|
| `supported` | la traza muestra directamente el comportamiento reportado (el contrato hace *trap* en lugar de devolver un error de contrato). **No** dice nada sobre explotabilidad | `UNCONTROLLED_PANIC` |
| `hypothesis` | candidato que depende de una política que no se ve black-box; requiere confirmación contra la política prevista | `POTENTIAL_VULN` (incluye `UNAUTHORIZED_ADDR_CALL` y `UNAUTHORIZED_CALL` con éxito, y el *trap* con llamadas anidadas) |
| `inconclusive` | la traza no explica el fallo en ningún sentido | `UNEXPECTED_ERROR`, `TIMEOUT`, `SIMULATION_FAIL` |

Aparte, y ya desde antes de este bloque, **no son hallazgos**: `OPERATIONAL_ERROR` (falló la herramienta o la red) y `NOT_EVALUATED` (la hipótesis no puede evaluarse con lo ejecutado) van a `coverage`, no a `findings`.

Dónde se ve:
- JSON: `findings[].status` y `summary.byStatus` (`supported + hypothesis + inconclusive = totalFindings`).
- Terminal: cada hallazgo muestra `(estado)`; el resumen añade `N supported | N hypotheses (need confirmation) | N inconclusive`; el texto de `POTENTIAL_VULN` por acceso dice "HYPOTHESIS, not a confirmed vulnerability". El PDF muestra el estado junto a la señal.
- Pruebas de regresión: `finding_status.test.ts` (mapa señal→estado escrito a mano, severidades sin cambios, redacción de la hipótesis, suma de `byStatus`, resumen en terminal sin presentarla como vulnerabilidad).

## Severidades: se conservan, con esta justificación
No se bajó ninguna severidad. `severity` queda definida como **prioridad de triage si el hallazgo se confirma** (impacto potencial), y `status` dice cuánto está establecido. Cambiar la severidad para "mejorar" el recuento habría mezclado de nuevo ambas cosas y hecho incomparables los informes históricos.
- `POTENTIAL_VULN` HIGH/CRITICAL (CRITICAL si el nombre de la función sugiere administración): si la hipótesis se confirma, el impacto es el de un control de acceso ausente; el nombre es una heurística, no una política. Se conserva como prioridad; **ya no se presenta como vulnerabilidad**: es `hypothesis`.
- `UNCONTROLLED_PANIC` MEDIUM: robustez, no explotabilidad; `supported` porque la traza lo demuestra.
- `UNEXPECTED_ERROR` MEDIUM: se conserva como prioridad de revisión manual, pero su estado es `inconclusive`. **Pendiente de decisión de Alex:** si un resultado inconcluso debe llevar MEDIUM o INFO. Hasta decidirlo, ningún resumen lo cuenta como defecto.

## Cómo interpretar informes históricos
Los JSON anteriores a `339e035` **no se tocan** y no traen `status`. Se leen con la misma tabla, por señal:
- `POTENTIAL_VULN` → hipótesis (S1 y S2: un HIGH `UNAUTHORIZED_ADDR_CALL` cada uno, artefacto de fixtures sin `require_auth`; el control `abcb6a4` detecta la función vulnerable conocida 3/3, pero eso es un resultado de fixture con política conocida).
- `UNEXPECTED_ERROR` → inconcluso (A-1: 24 inconclusos, 0 respaldados, 0 hipótesis).
- `bySeverity` de esos informes mezcla estados; no leerlo como "N vulnerabilidades".

## Consumo por `--fail-on` en D3 (diseño, sin implementar)
`--fail-on` y `--fail-on-incomplete` son entregable de la semana 3; esta es la restricción que impone la distinción de hoy, no una implementación:
1. `--fail-on <severity>` debe evaluarse **solo sobre hallazgos `supported`** por defecto. Una hipótesis o un inconcluso no falla el pipeline por sí solos.
2. Opción explícita (nombre por decidir en D3) para incluir `hypothesis` en el umbral; nunca implícita.
3. `--fail-on-incomplete` cubre lo que **no** es hallazgo: `OPERATIONAL_ERROR`, `NOT_EVALUATED`, presupuesto agotado, funciones sin invocaciones, y `inconclusive` si se decide; su código de salida debe ser distinto del de hallazgos (precedencia 1>2>3>0 del plan).
4. La salida del gate debe imprimir los recuentos por estado para que un fallo sea explicable sin abrir el JSON.
5. Informes sin `status` (históricos) se interpretan con el mapa señal→estado de arriba; el mapa vive en código (`findingStatus`) y se reutiliza.
