use diesel::pg::PgConnection;
use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::{
    job_dependencies, job_errors, jobs, replay_history, task_logs, task_metrics,
};
use super::PostgresStorage;
use crate::error::{QueueError, Result};
use crate::job::{now_millis, Job, JobStatus, NewJob};
use crate::storage::QueueStats;

crate::storage::diesel_common::impl_diesel_job_ops!(PostgresStorage, PgConnection);
