#![no_std]

//! Kuyfi composite/UDT verification fixture.
//!
//! This contract exists SOLELY to give Kuyfi's Chaos Monkey a real, deployed
//! Testnet target that exposes every composite Soroban type Kuyfi's UDT
//! registry and type-aware fuzzer need to prove against a live contract:
//! struct, enum (plain, C-like discriminant), union (Rust-style enum with
//! payload), nested UDT, Vec<UDT>, and Option<UDT>.
//!
//! Deliberately minimal: every function just validates the shape of its
//! input and echoes it back (or a small derived value). There is no
//! business logic here worth auditing — the goal is to verify that Kuyfi can
//! parse these types from a real contractspecv0 section and send
//! type-correct composite values against a real invocation, not to find a
//! bug in this fixture.

use soroban_sdk::{contract, contractimpl, contracttype, Env, Vec};

/// struct — plain named-field record. Also used as a nested-UDT payload
/// (inside Wrapper, and inside Action::Move).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Point {
    pub x: i128,
    pub y: i128,
}

/// enum — plain C-like enum with explicit discriminants. Serializes as a
/// bare ScVal::U32(value), per ScSpecEntryUdtEnumV0 / ScSpecUdtEnumCaseV0.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    Active = 1,
    Paused = 2,
    Closed = 3,
}

/// union — Rust-style enum with per-variant payload. Serializes as
/// ScVal::Vec([Symbol(variant_name), ...payload]), per
/// ScSpecEntryUdtUnionV0 / ScSpecUdtUnionCaseV0 (Void/Tuple arms).
/// `Move(Point, Point)` is a nested UDT used as a tuple-case payload.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Noop,
    SetValue(u32),
    Move(Point, Point),
}

/// Nested UDT — a struct whose own fields are other UDTs (a struct and an
/// enum), exercising registry recursion beyond one level.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Wrapper {
    pub status: Status,
    pub anchor: Point,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    /// struct parameter — echoes it back unchanged.
    pub fn echo_point(_env: Env, p: Point) -> Point {
        p
    }

    /// enum parameter — echoes it back unchanged.
    pub fn echo_status(_env: Env, s: Status) -> Status {
        s
    }

    /// union parameter (including its nested-UDT tuple case) — echoes it
    /// back unchanged.
    pub fn echo_action(_env: Env, a: Action) -> Action {
        a
    }

    /// nested UDT parameter (struct containing a struct and an enum) —
    /// echoes it back unchanged.
    pub fn echo_wrapper(_env: Env, w: Wrapper) -> Wrapper {
        w
    }

    /// Vec<UDT> parameter — returns how many elements were received plus
    /// the first one, a minimal way to prove each element was decoded.
    pub fn echo_points(_env: Env, pts: Vec<Point>) -> (u32, Option<Point>) {
        (pts.len(), pts.get(0))
    }

    /// Option<UDT> parameter — echoes it back unchanged (None stays None).
    pub fn echo_maybe_point(_env: Env, p: Option<Point>) -> Option<Point> {
        p
    }
}
