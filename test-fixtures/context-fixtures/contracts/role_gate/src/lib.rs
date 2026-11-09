#![no_std]
//! D1 fixture S1 `RoleGate`: a stored-role precondition and NO `require_auth`
//! anywhere, so D1 results are not confounded with D2 authorization.
//! `privileged_set` succeeds only when `caller` equals the stored operator and
//! then emits `role_ok` AFTER the check (the observable).
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotOperator = 3,
}

#[contracttype]
pub enum Key {
    Operator,
    Value,
}

#[contract]
pub struct RoleGate;

#[contractimpl]
impl RoleGate {
    pub fn init(env: Env, operator: Address) -> Result<(), Error> {
        if env.storage().instance().has(&Key::Operator) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Operator, &operator);
        Ok(())
    }

    pub fn privileged_set(env: Env, caller: Address, value: i128) -> Result<(), Error> {
        let operator: Address = env
            .storage()
            .instance()
            .get(&Key::Operator)
            .ok_or(Error::NotInitialized)?;
        if caller != operator {
            return Err(Error::NotOperator);
        }
        env.storage().persistent().set(&Key::Value, &value);
        env.events().publish((symbol_short!("role_ok"), caller), value);
        Ok(())
    }

    pub fn get_operator(env: Env) -> Option<Address> {
        env.storage().instance().get(&Key::Operator)
    }

    pub fn get_value(env: Env) -> i128 {
        env.storage().persistent().get(&Key::Value).unwrap_or(0)
    }
}
