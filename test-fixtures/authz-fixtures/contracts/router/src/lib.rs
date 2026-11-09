#![no_std]
//! D2 fixture `Router` (nested authorization). `forward(actor, amount)` requires
//! the actor's authorization (root node) and then calls `Executor.execute`
//! with the same actor, which requires it again (inner node).
use soroban_sdk::{contract, contractimpl, contracttype, vec, Address, Env, IntoVal, Symbol};

#[contracttype]
pub enum Key {
    Executor,
}

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    pub fn init(env: Env, executor: Address) {
        env.storage().instance().set(&Key::Executor, &executor);
    }

    pub fn forward(env: Env, actor: Address, amount: u32) {
        actor.require_auth();
        let executor: Address = env.storage().instance().get(&Key::Executor).unwrap();
        env.invoke_contract::<()>(
            &executor,
            &Symbol::new(&env, "execute"),
            vec![&env, actor.into_val(&env), amount.into_val(&env)],
        );
    }
}
