use diesel::prelude::*;

use super::super::models::RateLimitRow;
use super::super::schema::rate_limits;
use super::SqliteStorage;
use crate::error::Result;
use crate::job::now_millis;

impl SqliteStorage {
    pub fn get_rate_limit(&self, key: &str) -> Result<Option<RateLimitRow>> {
        let mut conn = self.conn()?;

        let row: Option<RateLimitRow> = rate_limits::table
            .find(key)
            .select(RateLimitRow::as_select())
            .first(&mut conn)
            .optional()?;

        Ok(row)
    }

    pub fn upsert_rate_limit(&self, row: &RateLimitRow) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::replace_into(rate_limits::table)
            .values(row)
            .execute(&mut conn)?;

        Ok(())
    }

    /// Atomically try to acquire a rate limit token.
    /// Does the read-refill-consume-write in a single transaction to prevent
    /// race conditions between concurrent workers.
    pub fn try_acquire_token(&self, key: &str, max_tokens: f64, refill_rate: f64) -> Result<bool> {
        let mut conn = self.conn()?;
        let now = now_millis();

        conn.transaction(|conn| {
            let existing: Option<RateLimitRow> = rate_limits::table
                .find(key)
                .select(RateLimitRow::as_select())
                .first(conn)
                .optional()?;

            let mut row = match existing {
                Some(r) => r,
                None => RateLimitRow {
                    key: key.to_string(),
                    tokens: max_tokens,
                    max_tokens,
                    refill_rate,
                    last_refill: now,
                },
            };

            // Refill tokens based on elapsed time
            let elapsed_ms = (now - row.last_refill).max(0) as f64;
            let elapsed_sec = elapsed_ms / 1000.0;
            let refilled = row.tokens + elapsed_sec * refill_rate;
            row.tokens = refilled.min(max_tokens);
            row.last_refill = now;

            // Try to consume one token
            let acquired = if row.tokens >= 1.0 {
                row.tokens -= 1.0;
                true
            } else {
                false
            };

            diesel::replace_into(rate_limits::table)
                .values(&row)
                .execute(conn)?;

            Ok(acquired)
        })
    }
}
