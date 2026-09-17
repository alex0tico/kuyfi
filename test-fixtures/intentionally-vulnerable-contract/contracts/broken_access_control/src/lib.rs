#![no_std]

// Fixture for a controlled Kuyfi demo. Contains a DELIBERATE broken-access-
// control bug alongside a correctly-guarded control function, so the two
// can be fuzzed and compared side by side. Testnet-only fixture — not for
// production use, not part of Kuyfi's own source tree.

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

const VALUE_KEY: Symbol = symbol_short!("VALUE");

#[contract]
pub struct BrokenAccessControl;

#[contractimpl]
impl BrokenAccessControl {
    /// VULNERABLE: administrative write with NO authorization check.
    /// Missing: admin.require_auth().
    /// Any caller can pass an arbitrary `admin` address and this will still
    /// write to persistent storage, because the contract never verifies
    /// that `admin` actually authorized the call.
    pub fn set_admin_value(env: Env, admin: Address, value: i128) {
        // INTENTIONALLY VULNERABLE — no admin.require_auth() here.
        let _ = admin;
        env.storage().persistent().set(&VALUE_KEY, &value);
    }

    /// SECURE CONTROL: same operation, but requires the `admin` address to
    /// have authorized the call before storage is touched.
    pub fn secure_set_admin_value(env: Env, admin: Address, value: i128) {
        admin.require_auth();
        env.storage().persistent().set(&VALUE_KEY, &value);
    }

    /// Reads back the current stored value (0 if never set).
    pub fn get_value(env: Env) -> i128 {
        env.storage().persistent().get(&VALUE_KEY).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn vulnerable_write_succeeds_without_auth() {
        let env = Env::default();
        let contract_id = env.register(BrokenAccessControl, ());
        let client = BrokenAccessControlClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        // No env.mock_all_auths() / auth mocking — proves no auth is required.
        client.set_admin_value(&admin, &42);

        assert_eq!(client.get_value(), 42);
    }

    #[test]
    #[should_panic]
    fn secure_write_rejected_without_auth() {
        let env = Env::default();
        let contract_id = env.register(BrokenAccessControl, ());
        let client = BrokenAccessControlClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        // No auth mocked — require_auth() must panic.
        client.secure_set_admin_value(&admin, &42);
    }

    #[test]
    fn secure_write_succeeds_with_auth() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BrokenAccessControl, ());
        let client = BrokenAccessControlClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.secure_set_admin_value(&admin, &7);

        assert_eq!(client.get_value(), 7);
    }
}
