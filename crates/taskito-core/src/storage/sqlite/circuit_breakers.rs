use diesel::prelude::*;

use super::super::models::CircuitBreakerRow;
use super::super::schema::circuit_breakers;
use super::SqliteStorage;
use crate::error::Result;

impl SqliteStorage {
    /// Get or create a circuit breaker state for a task.
    pub fn get_circuit_breaker(&self, task_name: &str) -> Result<Option<CircuitBreakerRow>> {
        let mut conn = self.conn()?;
        let row = circuit_breakers::table
            .find(task_name)
            .select(CircuitBreakerRow::as_select())
            .first(&mut conn)
            .optional()?;
        Ok(row)
    }

    /// Upsert circuit breaker state.
    pub fn upsert_circuit_breaker(&self, row: &CircuitBreakerRow) -> Result<()> {
        let mut conn = self.conn()?;
        diesel::replace_into(circuit_breakers::table)
            .values(row)
            .execute(&mut conn)?;
        Ok(())
    }

    /// Get all circuit breaker states.
    pub fn list_circuit_breakers(&self) -> Result<Vec<CircuitBreakerRow>> {
        let mut conn = self.conn()?;
        let rows = circuit_breakers::table
            .select(CircuitBreakerRow::as_select())
            .load(&mut conn)?;
        Ok(rows)
    }
}
