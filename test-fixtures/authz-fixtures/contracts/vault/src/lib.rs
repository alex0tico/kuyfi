#![no_std]
//! D2 fixture `Vault` (Ed25519 actors). Both entry points require the
//! actor's authorization; `admin_set` then additionally requires the actor to
//! be the stored admin, failing with `Error::NotAdmin` (contract stage, after
//! `require_auth` has passed).
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
}

#[contracttype]
pub enum Key {
    Admin,
    AdminValue,
    Value(Address),
}

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&Key::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        Ok(())
    }

    pub fn protected_set(env: Env, actor: Address, value: u32) {
        actor.require_auth();
        env.storage()
            .persistent()
            .set(&Key::Value(actor.clone()), &value);
        env.events().publish((symbol_short!("pset"), actor), value);
    }

    pub fn admin_set(env: Env, actor: Address, value: u32) -> Result<(), Error> {
        actor.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&Key::Admin)
            .ok_or(Error::NotInitialized)?;
        if actor != admin {
            return Err(Error::NotAdmin);
        }
        env.storage().persistent().set(&Key::AdminValue, &value);
        env.events().publish((symbol_short!("aset"), actor), value);
        Ok(())
    }

    pub fn get(env: Env, actor: Address) -> Option<u32> {
        env.storage().persistent().get(&Key::Value(actor))
    }

    pub fn get_admin_value(env: Env) -> Option<u32> {
        env.storage().persistent().get(&Key::AdminValue)
    }
}
