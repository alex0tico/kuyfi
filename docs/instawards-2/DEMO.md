# Demostración — guion de 3–4 minutos (preparado; NO grabado ni publicado)

Estado: guion y comandos **probados en lectura el 2026-10-22**. No está grabada ni publicada; eso ocurre cuando Alex la grabe. Todo el guion usa **evidencia guardada** (no hay red, no hay transacciones nuevas) y fixtures propias. **Nada de lo que se muestra se ejecuta en vivo: dilo en cámara.**

## Antes de grabar (fuera de cámara, 1 min)
`cd` a la raíz del worktree público (el directorio `kuyfi-public`, rama `instawards-2/week-1-public`, árbol limpio, sin archivos privados); `npm run build` (no es necesario para los pasos, solo si quieres mostrar `kuyfi --help`); terminal limpia, fuente grande. No grabes desde el directorio de trabajo privado (`kuyfi/`: allí hay un PDF privado y la rama completa). No abras `keys.json` ni variables `KUYFI_AUTHZ_*`, no uses `git add -A`.

## Guion (≈ 3 min 30 s)

| # | Tiempo | Comando exacto (todos de **solo lectura**, <1 s) | Qué señalar | Qué decir (español) |
|---|---|---|---|---|
| 1 | 0:00–0:20 | `git log --oneline -1 && git status --short` | un commit; árbol limpio | "Esto es KUYFI, un probador de caja negra para contratos Soroban. Todo lo que voy a mostrar es evidencia guardada de esta semana, sobre un commit concreto; nada se ejecuta en vivo." |
| 2 | 0:20–1:20 | `bash test-fixtures/baseline-evidence/demo.sh d1-stored` | (a) el bloque `context.roles.caller`; (b) en cada escenario: A y B = **0** eventos, C = **6** (S1) y **1** (S2); (c) `procedencia=100%`; (d) la última línea sobre los HIGH | "Primera mejora: contexto. Le damos a KUYFI un rol conocido en un archivo de configuración. Sin contexto, la versión 0.1.0 y el nuevo build llegan a cero eventos del observable; con contexto, el escenario S1 lo alcanza seis veces y S2 una, en tres de tres corridas. Son dos fixtures propias: una observación, no una medida de efectividad. Cada input generado lleva su procedencia: cien por ciento. Y ojo: los hallazgos HIGH de esas fixtures son hipótesis, no vulnerabilidades confirmadas." |
| 3 | 1:20–1:50 | `cat test-fixtures/baseline-evidence/context-fixtures/configs/S1-C-simulate.json` | `"mode": "simulate-only"` en `limits` | "Segunda: límites por campaña. Con este archivo la campaña es solo simulación, y el cliente bloquea cualquier envío de transacciones a nivel de red; también se limitan funciones, familias de vectores y el máximo de vectores." |
| 4 | 1:50–2:40 | `bash test-fixtures/baseline-evidence/demo.sh authz-stored` | `ed25519-run-1 … executed 7/7`, `custom-account … 5/5`, `nested … 4/4`; las líneas `on-chain … SUCCESS ledger …`; la última línea ("NOT the acceptance of D2") | "Tercera: autorización integrada en KUYFI. El comando `kuyfi authz` construye y firma las autorizaciones, las simula en modo enforcing explícito con una cuenta distinta del actor, y atribuye cada rechazo a su etapa. Estas son corridas guardadas del producto: Ed25519, cuenta personalizada y anidada, tres veces cada una, más cuatro transacciones incluidas en Testnet. 'Aceptado' aquí es la evaluación contra la matriz; la aceptación del entregable D2 todavía no está declarada." |
| 5 | 2:40–3:15 | `bash test-fixtures/baseline-evidence/demo.sh real-stored` | `solo simulacion`, `transacciones difundidas 0`, `procedencia 100%`, "bloqueado por CONTRACT/WASM_VM", `hallazgos por estado … 0 respaldados`; la última línea | "Estado real de los contratos externos: ya hicimos una campaña acotada, solo de simulación, en cada uno de los tres. Cero transacciones. En Contrato B y Contrato C casi todos los vectores se bloquean en validaciones del propio contrato, así que no llegamos a su lógica de negocio; y en Contrato A hay 24 resultados inconclusos. Ningún hallazgo respaldado, y eso no es una garantía de seguridad: es lo que una simulación sin estado puede ver. La autorización es una confirmación del solicitante." |
| 6 | 3:15–3:30 | `ls docs/instawards-2` | `WEEK-1-CLOSE.md`, `D1-ACCEPTANCE.md`, `D2-EVIDENCE-MAP.md` | "Todo está documentado en el repositorio: criterios de D1, mapa de evidencia de D2 y lo que falta. Esto es la semana uno; D3 y la aceptación final de D2 vienen después." |

**Regla de cámara:** los pasos 2, 4 y 5 leen JSON guardados; los resultados son de ejecuciones del 21 y 22 de octubre de 2026. No digas "ahora ejecuto". Los reportes completos de contratos de terceros **no** forman parte del repositorio público ni se muestran; `real-stored` lee solo `real-contracts-aggregate/aggregate.json` (agregados, sin Contract IDs, hashes, nombres de funciones ni transacciones).

## Si quieres una ejecución en vivo (opcional; no está en el guion)
`bash test-fixtures/baseline-evidence/demo.sh authz-product` (~4 min, despliega fixtures propias y envía **1** transacción a Testnet; requiere red y Stellar CLI). Si falla, vuelve al paso 4 y dilo.

## Qué es cada cosa (para no mezclar en cámara)
- **Producto:** `kuyfi authz` (`source/modules/authz/`), la configuración y los límites (`source/modules/chaos_monkey/`).
- **Experimento previo:** scripts `test-fixtures/authz-fixtures/spike/*.mjs` (run-0/run-1); no se muestran en el guion.
- **Guardado vs en vivo:** todo el guion es guardado.

## Probado (2026-10-22; reverificado 2026-10-24 en la rama pública)
Los comandos de los pasos 1–6 se ejecutaron sin errores; duración de cada comando < 1 s. El 2026-10-24 se repitieron en el worktree público: `d1-stored`, `authz-stored` y `real-stored` dan los mismos números (el paso 5 ahora imprime la fecha de ejecución y etiquetas `A-1`, `B-1`, `C-1`). La duración total del video depende de la locución (≈ 3 min 30 s).

## Estado de publicación
**Nada publicado ni grabado.** Ver `WEEK-1-CLOSE.md` §Publicación.
