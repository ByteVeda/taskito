use diesel::prelude::*;

use crate::error::Result;
use crate::job::now_millis;
use super::super::models::*;
use super::super::schema::task_metrics;
use super::SqliteStorage;

impl SqliteStorage {
    /// Record a task execution metric.
    pub fn record_metric(
        &self,
        task_name: &str,
        job_id: &str,
        wall_time_ns: i64,
        memory_bytes: i64,
        succeeded: bool,
    ) -> Result<()> {
        let mut conn = self.conn()?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_millis();

        let row = NewTaskMetricRow {
            id: &id,
            task_name,
            job_id,
            wall_time_ns,
            memory_bytes,
            succeeded,
            recorded_at: now,
        };

        diesel::insert_into(task_metrics::table)
            .values(&row)
            .execute(&mut conn)?;

        Ok(())
    }

    /// Get aggregated metrics for a task (or all tasks if name is None).
    pub fn get_metrics(&self, name: Option<&str>, since_ms: i64) -> Result<Vec<TaskMetricRow>> {
        let mut conn = self.conn()?;

        let mut query = task_metrics::table
            .filter(task_metrics::recorded_at.ge(since_ms))
            .into_boxed();

        if let Some(n) = name {
            query = query.filter(task_metrics::task_name.eq(n));
        }

        let rows = query
            .order(task_metrics::recorded_at.desc())
            .select(TaskMetricRow::as_select())
            .load(&mut conn)?;

        Ok(rows)
    }

    /// Purge old metric records.
    pub fn purge_metrics(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let affected = diesel::delete(
            task_metrics::table.filter(task_metrics::recorded_at.lt(older_than_ms))
        ).execute(&mut conn)?;
        Ok(affected as u64)
    }

    /// Record a replay event.
    pub fn record_replay(
        &self,
        original_job_id: &str,
        replay_job_id: &str,
        original_result: Option<&[u8]>,
        replay_result: Option<&[u8]>,
        original_error: Option<&str>,
        replay_error: Option<&str>,
    ) -> Result<()> {
        use super::super::schema::replay_history;

        let mut conn = self.conn()?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_millis();

        let row = NewReplayHistoryRow {
            id: &id,
            original_job_id,
            replay_job_id,
            replayed_at: now,
            original_result,
            replay_result,
            original_error,
            replay_error,
        };

        diesel::insert_into(replay_history::table)
            .values(&row)
            .execute(&mut conn)?;

        Ok(())
    }

    /// Get replay history for a job.
    pub fn get_replay_history(&self, original_job_id: &str) -> Result<Vec<ReplayHistoryRow>> {
        use super::super::schema::replay_history;

        let mut conn = self.conn()?;
        let rows = replay_history::table
            .filter(replay_history::original_job_id.eq(original_job_id))
            .order(replay_history::replayed_at.desc())
            .select(ReplayHistoryRow::as_select())
            .load(&mut conn)?;
        Ok(rows)
    }
}
