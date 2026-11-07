#![no_std]
//! D2 fixture `PolicyAccount` (custom account). Signature format is its own:
//! `{public_key, signature}` (Ed25519 over the 32-byte payload). The policy
//! over `auth_contexts` allows only `protected_set` with `value <= LIMIT`;
//! each rejection has a distinct contract error, and the allowed branch emits
//! a `policy_ok` event.
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    symbol_short, Env, BytesN, Symbol, TryFromVal, Vec,
};

pub const LIMIT: u32 = 100;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    UnknownKey = 10,
    FunctionNotAllowed = 11,
    AmountExceeded = 12,
    BadContext = 13,
}

#[contracttype]
#[derive(Clone)]
pub struct Signature {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracttype]
pub enum Key {
    Owner,
}

#[contract]
pub struct PolicyAccount;

#[contractimpl]
impl PolicyAccount {
    pub fn init(env: Env, owner: BytesN<32>) -> Result<(), Error> {
        if env.storage().instance().has(&Key::Owner) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Owner, &owner);
        Ok(())
    }
}

#[contractimpl]
impl CustomAccountInterface for PolicyAccount {
    type Signature = Signature;
    type Error = Error;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: Signature,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let owner: BytesN<32> = env
            .storage()
            .instance()
            .get(&Key::Owner)
            .ok_or(Error::NotInitialized)?;
        if signature.public_key != owner {
            return Err(Error::UnknownKey);
        }
        // Traps (host crypto error) when the signature does not verify.
        env.crypto().ed25519_verify(
            &signature.public_key,
            &signature_payload.into(),
            &signature.signature,
        );
        for ctx in auth_contexts.iter() {
            match ctx {
                Context::Contract(c) => {
                    if c.fn_name != Symbol::new(&env, "protected_set") {
                        return Err(Error::FunctionNotAllowed);
                    }
                    let value = c
                        .args
                        .get(1)
                        .and_then(|v| u32::try_from_val(&env, &v).ok())
                        .ok_or(Error::BadContext)?;
                    if value > LIMIT {
                        return Err(Error::AmountExceeded);
                    }
                }
                _ => return Err(Error::BadContext),
            }
        }
        env.events().publish((symbol_short!("policy_ok"),), ());
        Ok(())
    }
}
