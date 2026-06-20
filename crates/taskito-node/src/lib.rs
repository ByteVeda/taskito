//! Node.js (napi-rs) bindings for the Taskito task-queue core.
//!
//! A thin binding shell — peer to the Python shell in `crates/taskito-python`.
//! All scheduling and storage logic lives in `taskito-core`; this crate only
//! marshals between JS values and the core and (later) dispatches task
//! execution back into JavaScript.

mod config;
mod conversion;
mod error;
mod queue;

pub use queue::JsQueue;
