use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::task_logs;
use super::PostgresStorage;
use crate::error::Result;
use crate::job::now_millis;

impl PostgresStorage {
    /// Write a structured log entry for a task.
    pub fn write_task_log(
        &self,
        job_id: &str,
        task_name: &str,
        level: &str,
        message: &str,
        extra: Option<&str>,
    ) -> Result<()> {
        let mut conn = self.conn()?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_millis();

        let row = NewTaskLogRow {
            id: &id,
            job_id,
            task_name,
            level,
            message,
            extra,
            logged_at: now,
        };

        diesel::insert_into(task_logs::table)
            .values(&row)
            .execute(&mut conn)?;

        Ok(())
    }

    /// Get logs for a specific job.
    pub fn get_task_logs(&self, job_id: &str) -> Result<Vec<TaskLogRow>> {
        let mut conn = self.conn()?;
        let rows = task_logs::table
            .filter(task_logs::job_id.eq(job_id))
            .order(task_logs::logged_at.asc())
            .select(TaskLogRow::as_select())
            .load(&mut conn)?;
        Ok(rows)
    }

    /// Query logs by task name, level, etc.
    pub fn query_task_logs(
        &self,
        task_name: Option<&str>,
        level: Option<&str>,
        since_ms: i64,
        limit: i64,
    ) -> Result<Vec<TaskLogRow>> {
        let mut conn = self.conn()?;

        let mut query = task_logs::table
            .filter(task_logs::logged_at.ge(since_ms))
            .into_boxed();

        if let Some(n) = task_name {
            query = query.filter(task_logs::task_name.eq(n));
        }
        if let Some(l) = level {
            query = query.filter(task_logs::level.eq(l));
        }

        let rows = query
            .order(task_logs::logged_at.desc())
            .limit(limit)
            .select(TaskLogRow::as_select())
            .load(&mut conn)?;

        Ok(rows)
    }

    /// Purge old log records.
    pub fn purge_task_logs(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let affected =
            diesel::delete(task_logs::table.filter(task_logs::logged_at.lt(older_than_ms)))
                .execute(&mut conn)?;
        Ok(affected as u64)
    }
}
