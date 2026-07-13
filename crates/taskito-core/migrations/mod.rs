//! Ordered registry of code-first schema migrations for the core storage.
//!
//! These files live at the crate root (`crates/taskito-core/migrations/`) and
//! are pulled into the crate from `src/storage/mod.rs` via `#[path]`. Each
//! module defines one [`Migration`](crate::storage::migrate::Migration); add a
//! new numbered module and append it to [`all`] to extend the schema.

mod m0001_initial;
mod m0002_scaling_indexes;

use crate::storage::migrate::Migration;

/// Every core migration, oldest first.
pub fn all() -> Vec<Box<dyn Migration>> {
    vec![
        Box::new(m0001_initial::M0001Initial),
        Box::new(m0002_scaling_indexes::M0002ScalingIndexes),
    ]
}
