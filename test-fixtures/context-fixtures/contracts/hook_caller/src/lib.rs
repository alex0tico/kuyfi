#![no_std]
//! D1 fixture S2 `HookCaller`: `call_hook(target)` invokes `target.ping()`
//! (the referenced contract must expose `ping`) and emits `hook_ok` AFTER that
//! call returns (the observable). No `require_auth`.
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Address, Env, Symbol};

#[contract]
pub struct HookCaller;

#[contractimpl]
impl HookCaller {
    pub fn call_hook(env: Env, target: Address) -> u32 {
        let answer: u32 = env.invoke_contract(&target, &Symbol::new(&env, "ping"), vec![&env]);
        env.events().publish((symbol_short!("hook_ok"), target), answer);
        answer
    }
}
