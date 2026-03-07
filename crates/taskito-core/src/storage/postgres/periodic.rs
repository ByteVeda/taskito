use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::periodic_tasks;
use super::PostgresStorage;
use crate::error::Result;

impl PostgresStorage {
    /// Register or update a periodic task.
    pub fn register_periodic(&self, task: &NewPeriodicTaskRow) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::insert_into(periodic_tasks::table)
            .values(task)
            .on_conflict(periodic_tasks::name)
            .do_update()
            .set(task)
            .execute(&mut conn)?;

        Ok(())
    }

    /// Get all periodic tasks that are due to run.
    pub fn get_due_periodic(&self, now: i64) -> Result<Vec<PeriodicTaskRow>> {
        let mut conn = self.conn()?;

        let rows = periodic_tasks::table
            .filter(periodic_tasks::enabled.eq(true))
            .filter(periodic_tasks::next_run.le(now))
            .select(PeriodicTaskRow::as_select())
            .load(&mut conn)?;

        Ok(rows)
    }

    /// Update a periodic task's schedule after execution.
    pub fn update_periodic_schedule(&self, name: &str, last_run: i64, next_run: i64) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::update(periodic_tasks::table.find(name))
            .set((
                periodic_tasks::last_run.eq(last_run),
                periodic_tasks::next_run.eq(next_run),
            ))
            .execute(&mut conn)?;

        Ok(())
    }
}
