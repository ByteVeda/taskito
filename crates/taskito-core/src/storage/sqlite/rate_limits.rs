use diesel::prelude::*;

use crate::error::Result;
use super::super::models::RateLimitRow;
use super::super::schema::rate_limits;
use super::SqliteStorage;

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
}
