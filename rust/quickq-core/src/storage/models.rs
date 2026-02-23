use diesel::prelude::*;

use super::schema::{dead_letter, job_errors, jobs, periodic_tasks, rate_limits};

/// A row in the `jobs` table (for SELECT queries).
#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = jobs)]
pub struct JobRow {
    pub id: String,
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub status: i32,
    pub priority: i32,
    pub created_at: i64,
    pub scheduled_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub result: Option<Vec<u8>>,
    pub error: Option<String>,
    pub timeout_ms: i64,
    pub unique_key: Option<String>,
    pub progress: Option<i32>,
    pub metadata: Option<String>,
}

/// Insertable struct for creating new jobs.
#[derive(Insertable, Debug)]
#[diesel(table_name = jobs)]
pub struct NewJobRow<'a> {
    pub id: &'a str,
    pub queue: &'a str,
    pub task_name: &'a str,
    pub payload: &'a [u8],
    pub status: i32,
    pub priority: i32,
    pub created_at: i64,
    pub scheduled_at: i64,
    pub retry_count: i32,
    pub max_retries: i32,
    pub timeout_ms: i64,
    pub unique_key: Option<&'a str>,
    pub metadata: Option<&'a str>,
}

/// A row in the `dead_letter` table.
#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = dead_letter)]
pub struct DeadLetterRow {
    pub id: String,
    pub original_job_id: String,
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub error: Option<String>,
    pub retry_count: i32,
    pub failed_at: i64,
    pub metadata: Option<String>,
}

/// Insertable struct for dead letter entries.
#[derive(Insertable, Debug)]
#[diesel(table_name = dead_letter)]
pub struct NewDeadLetterRow<'a> {
    pub id: &'a str,
    pub original_job_id: &'a str,
    pub queue: &'a str,
    pub task_name: &'a str,
    pub payload: &'a [u8],
    pub error: Option<&'a str>,
    pub retry_count: i32,
    pub failed_at: i64,
    pub metadata: Option<&'a str>,
}

/// A row in the `rate_limits` table.
#[derive(Queryable, Selectable, Insertable, AsChangeset, Debug, Clone)]
#[diesel(table_name = rate_limits)]
pub struct RateLimitRow {
    pub key: String,
    pub tokens: f64,
    pub max_tokens: f64,
    pub refill_rate: f64,
    pub last_refill: i64,
}

/// A row in the `periodic_tasks` table.
#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = periodic_tasks)]
pub struct PeriodicTaskRow {
    pub name: String,
    pub task_name: String,
    pub cron_expr: String,
    pub args: Option<Vec<u8>>,
    pub kwargs: Option<Vec<u8>>,
    pub queue: String,
    pub enabled: bool,
    pub last_run: Option<i64>,
    pub next_run: i64,
}

/// Insertable struct for periodic tasks.
#[derive(Insertable, AsChangeset, Debug)]
#[diesel(table_name = periodic_tasks)]
pub struct NewPeriodicTaskRow<'a> {
    pub name: &'a str,
    pub task_name: &'a str,
    pub cron_expr: &'a str,
    pub args: Option<&'a [u8]>,
    pub kwargs: Option<&'a [u8]>,
    pub queue: &'a str,
    pub enabled: bool,
    pub next_run: i64,
}

/// A row in the `job_errors` table (for SELECT queries).
#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = job_errors)]
pub struct JobErrorRow {
    pub id: String,
    pub job_id: String,
    pub attempt: i32,
    pub error: String,
    pub failed_at: i64,
}

/// Insertable struct for job error entries.
#[derive(Insertable, Debug)]
#[diesel(table_name = job_errors)]
pub struct NewJobErrorRow<'a> {
    pub id: &'a str,
    pub job_id: &'a str,
    pub attempt: i32,
    pub error: &'a str,
    pub failed_at: i64,
}
