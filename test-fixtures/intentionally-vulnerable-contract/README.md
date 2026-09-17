# intentionally-vulnerable-contract

Fixture aislado para una prueba controlada de Kuyfi. **No es parte del
código de producción de Kuyfi** — es un workspace Cargo/Soroban
independiente, pensado para desplegarse ÚNICAMENTE en Stellar Testnet.

## Qué contiene

Un único contrato (`broken_access_control`) con tres funciones:

- `set_admin_value(admin: Address, value: i128)` — **VULNERABLE**. Nunca
  llama `admin.require_auth()`. Cualquier cuenta puede pasar cualquier
  dirección como `admin` y la escritura se ejecuta igual.
- `secure_set_admin_value(admin: Address, value: i128)` — **control
  seguro**. Misma operación, pero exige `admin.require_auth()` antes de
  tocar storage.
- `get_value()` — lee el valor persistido, para verificar el cambio de
  estado en ambos casos.

El nombre `set_admin_value` (en vez de `admin_set_value`) es deliberado:
coincide con el patrón real `set_admin` que Kuyfi usa en
`ADMIN_FUNCTION_PATTERNS` (`fuzzer_access.ts`) para reconocer funciones
administrativas, y describe honestamente lo que la función hace
("establecer un valor controlado por el admin"). No es un ajuste de
regex sin sentido de seguridad.

## Por qué existe

Demostrar, sin modificar el clasificador de Kuyfi, que Chaos Monkey
detecta un caso real de *broken access control* (ausencia de
`require_auth()`) y lo distingue correctamente de la misma operación
protegida.

## Reglas de esta prueba

- Solo Stellar Testnet. Nunca Mainnet.
- Sin fondos reales, sin usuarios reales.
- No se versionan claves secretas ni identidades de Stellar
  (ver `.gitignore` local de esta carpeta).
- No se modifica ningún archivo bajo `source/` de Kuyfi.
