#![no_std]
//! D2 fixture `Executor` (nested authorization). `execute(actor, amount)`
//! requires the actor's authorization AGAIN (the inner node) and changes state.
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

#[contracttype]
pub enum Key {
    Executed(Address),
}

#[contract]
pub struct Executor;

#[contractimpl]
impl Executor {
    pub fn execute(env: Env, actor: Address, amount: u32) {
        actor.require_auth();
        env.storage().persistent().set(&Key::Executed(actor.clone()), &amount);
        env.events().publish((symbol_short!("exec"), actor), amount);
    }

    pub fn get(env: Env, actor: Address) -> Option<u32> {
        env.storage().persistent().get(&Key::Executed(actor))
    }
}
