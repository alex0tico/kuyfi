#![no_std]
//! D1 fixture S2 helper `PingTarget`: exposes `ping() -> u32`. No auth.
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct PingTarget;

#[contractimpl]
impl PingTarget {
    pub fn ping(_env: Env) -> u32 {
        42
    }
}
