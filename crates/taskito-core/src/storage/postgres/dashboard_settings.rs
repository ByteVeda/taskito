use std::collections::HashMap;

use diesel::prelude::*;

use super::super::models::DashboardSettingRow;
use super::super::schema::dashboard_settings;
use super::PostgresStorage;
use crate::error::Result;
use crate::job::now_millis;

impl PostgresStorage {
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut conn = self.conn()?;
        let row: Option<DashboardSettingRow> = dashboard_settings::table
            .filter(dashboard_settings::key.eq(key))
            .first::<DashboardSettingRow>(&mut conn)
            .optional()?;
        Ok(row.map(|r| r.value))
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();
        let row = DashboardSettingRow {
            key: key.to_string(),
            value: value.to_string(),
            updated_at: now,
        };
        diesel::insert_into(dashboard_settings::table)
            .values(&row)
            .on_conflict(dashboard_settings::key)
            .do_update()
            .set((
                dashboard_settings::value.eq(value),
                dashboard_settings::updated_at.eq(now),
            ))
            .execute(&mut conn)?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let deleted =
            diesel::delete(dashboard_settings::table.filter(dashboard_settings::key.eq(key)))
                .execute(&mut conn)?;
        Ok(deleted > 0)
    }

    pub fn list_settings(&self) -> Result<HashMap<String, String>> {
        let mut conn = self.conn()?;
        let rows: Vec<DashboardSettingRow> = dashboard_settings::table
            .select(DashboardSettingRow::as_select())
            .load(&mut conn)?;
        Ok(rows.into_iter().map(|r| (r.key, r.value)).collect())
    }
}
