//! Ordered registry of code-first workflow schema migrations.
//!
//! Recorded in a dedicated `workflow_schema_migrations` ledger so their version
//! numbers never collide with the core storage migrations on a shared database.

mod m0001_workflow_initial;
mod m0002_workflow_indexes;

use taskito_core::storage::migrate::Migration;

/// Every workflow migration, oldest first.
pub fn all() -> Vec<Box<dyn Migration>> {
    vec![
        Box::new(m0001_workflow_initial::M0001WorkflowInitial),
        Box::new(m0002_workflow_indexes::M0002WorkflowIndexes),
    ]
}
