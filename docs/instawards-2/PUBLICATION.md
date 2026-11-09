# Publicación de la semana 1 — qué se publica y cómo se relaciona con lo probado

Estado a 2026-10-24: **nada publicado** (sin push, merge, release, npm ni envío a X).

## Código probado vs. código publicable
- **Probado:** rama de trabajo `instawards-2/week-1` en `bd8ad55` (42 commits sobre `f360d8d`): 259 pruebas AVA aprobadas, 23 advertencias previas de XO; las evidencias de `test-fixtures/` y `docs/instawards-2/` se generaron con ese código.
- **Publicable:** rama `instawards-2/week-1-public`, creada sobre `f360d8d` (= `main` de `origin`, comprobado con `git ls-remote` el 2026-10-24), con el árbol de `bd8ad55` y estas diferencias, y sin el historial de la rama de trabajo:
  1. `source/` y `package.json` **idénticos** a `bd8ad55` (verificado con `git diff bd8ad55 -- source package.json` vacío).
  2. **Excluido:** datos de los experimentos D2 (`test-fixtures/authz-fixtures/`: evidencia con Contract IDs y cuentas; solo local, en `.gitignore`), informes completos y verificaciones de los tres contratos de colaboradores (`real-contracts/`), registros de campaña con Contract IDs, notas de pistas del Contrato B, el registro interno de ejecución y el script que sondea la firma de funciones de un contrato externo.
  3. **Añadido:** `test-fixtures/baseline-evidence/real-contracts-aggregate/aggregate.json` (solo agregados: sin Contract IDs, hashes WASM, nombres de funciones, transacciones ni enlaces).
  4. **Modificado:** `summarize_stored.mjs` (la sección `real` lee el agregado; es la única lógica distinta de lo probado, y solo imprime), `count_vectors.mjs` (ya no trae un Contract ID por defecto), `demo.sh` (un comentario), y los documentos `D1-ACCEPTANCE.md`, `WEEK-1-CLOSE.md`, `DEMO.md`, `D1-WEEK1.md`, `D2-EVIDENCE-MAP.md` (referencias y redacción pública).
- Los resultados por campaña son verificables contra los informes completos, que se conservan en local en la rama de trabajo; el agregado se generó de las reejecuciones con el build `8e6851c`.

## Resultados públicos (agregados; todos simulate-only, 0 transacciones, procedencia 100 %)
| Campaña | Fecha (UTC) | Vectores | Aceptados | Bloqueados | Hallazgos | No evaluados |
|---|---|---|---|---|---|---|
| A-1 | 2026-10-22 | 64 | 40 | 24 (trampas genéricas del host) | 24 inconclusos, 0 hipótesis, 0 respaldados | 6 |
| B-1 | 2026-10-22 | 32 | 0 | 32 (validación del propio contrato) | 0 | 0 |
| C-1 | 2026-10-22 | 69 | 14 | 55 (validación del propio contrato) | 0 | 2 |

Limitaciones: sin estado del contrato no se llegó a la lógica de negocio (Contrato B) ni a la dependiente de estado (Contrato C); 0 hallazgos no es seguridad; la autorización es una confirmación del solicitante (los colaboradores permitieron probar y divulgar resultados); versión de los contratos no declarada.

## Destino (no ejecutado)
Remoto `origin` = `https://github.com/alex0tico/kuyfi.git`, rama nueva `instawards-2/week-1-public` (no existe en el remoto). Sin tags ni release.

## Texto para X (≤ 280 caracteres; no enviado)
> KUYFI week 1 (Instawards 2): contextual config, input provenance and campaign limits for Soroban black-box testing, plus `kuyfi authz`, which builds and simulates auth entries in enforce mode. Testnet only; external contracts simulate-only. Early work, no security guarantee.
