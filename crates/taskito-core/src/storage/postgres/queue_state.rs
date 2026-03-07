use diesel::prelude::*;

use super::super::models::QueueStateRow;
use super::super::schema::queue_state;
use super::PostgresStorage;
use crate::error::Result;
use crate::job::now_millis;

impl PostgresStorage {
    pub fn pause_queue(&self, queue_name: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();

        let row = QueueStateRow {
            queue_name: queue_name.to_string(),
            paused: true,
            paused_at: Some(now),
        };

        diesel::insert_into(queue_state::table)
            .values(&row)
            .on_conflict(queue_state::queue_name)
            .do_update()
            .set((queue_state::paused.eq(true), queue_state::paused_at.eq(now)))
            .execute(&mut conn)?;

        Ok(())
    }

    pub fn resume_queue(&self, queue_name: &str) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::delete(queue_state::table.filter(queue_state::queue_name.eq(queue_name)))
            .execute(&mut conn)?;

        Ok(())
    }

    pub fn list_paused_queues(&self) -> Result<Vec<String>> {
        let mut conn = self.conn()?;

        let names: Vec<String> = queue_state::table
            .filter(queue_state::paused.eq(true))
            .select(queue_state::queue_name)
            .load(&mut conn)?;

        Ok(names)
    }
}
