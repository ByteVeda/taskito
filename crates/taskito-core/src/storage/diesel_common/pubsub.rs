/// Generates shared topic-subscription operation methods for Diesel-backed
/// storage backends.
///
/// `register_subscription` differs between SQLite (`replace_into`) and Postgres
/// (`on_conflict...do_update`), so it stays backend-specific. The remaining five
/// read/update/reap methods are identical and live here.
macro_rules! impl_diesel_pubsub_ops {
    ($storage_type:ty) => {
        impl $storage_type {
            /// Active subscriptions for a topic, in registration order.
            ///
            /// Ordering is `created_at` then `subscription_name` so every backend
            /// agrees on a stable, registration-time order.
            pub fn list_subscriptions_for_topic(
                &self,
                topic: &str,
            ) -> Result<Vec<$crate::storage::records::Subscription>> {
                let mut conn = self.conn()?;

                let rows = topic_subscriptions::table
                    .filter(topic_subscriptions::topic.eq(topic))
                    .filter(topic_subscriptions::active.eq(true))
                    .order((
                        topic_subscriptions::created_at.asc(),
                        topic_subscriptions::subscription_name.asc(),
                    ))
                    .select(SubscriptionRow::as_select())
                    .load::<SubscriptionRow>(&mut conn)?;

                Ok(rows.into_iter().map(Into::into).collect())
            }

            /// Every registered subscription, active or paused, across all topics.
            pub fn list_subscriptions(
                &self,
            ) -> Result<Vec<$crate::storage::records::Subscription>> {
                let mut conn = self.conn()?;

                let rows = topic_subscriptions::table
                    .select(SubscriptionRow::as_select())
                    .load::<SubscriptionRow>(&mut conn)?;

                Ok(rows.into_iter().map(Into::into).collect())
            }

            /// Remove a subscription. Returns false if none matched.
            pub fn unsubscribe(&self, topic: &str, subscription_name: &str) -> Result<bool> {
                let mut conn = self.conn()?;

                let affected =
                    diesel::delete(topic_subscriptions::table.find((topic, subscription_name)))
                        .execute(&mut conn)?;

                Ok(affected > 0)
            }

            /// Pause (false) or resume (true) a subscription without removing its
            /// registration. Returns false if none matched.
            pub fn set_subscription_active(
                &self,
                topic: &str,
                subscription_name: &str,
                active: bool,
            ) -> Result<bool> {
                let mut conn = self.conn()?;

                let affected =
                    diesel::update(topic_subscriptions::table.find((topic, subscription_name)))
                        .set(topic_subscriptions::active.eq(active))
                        .execute(&mut conn)?;

                Ok(affected > 0)
            }

            /// Remove ephemeral subscriptions whose owner is not in
            /// `live_worker_ids`. Durable rows (owner NULL) are excluded by the
            /// `is_not_null` filter and never touched. Rows younger than the
            /// registration grace window survive: a starting worker inserts its
            /// ephemeral subscriptions before its first heartbeat lands, and
            /// another worker's reap tick must not race that gap.
            /// Returns the count removed.
            pub fn reap_ephemeral_subscriptions(&self, live_worker_ids: &[String]) -> Result<u64> {
                let mut conn = self.conn()?;
                let cutoff =
                    $crate::job::now_millis() - $crate::storage::EPHEMERAL_SUBSCRIPTION_GRACE_MS;

                let affected = diesel::delete(
                    topic_subscriptions::table
                        .filter(topic_subscriptions::owner_worker_id.is_not_null())
                        .filter(topic_subscriptions::owner_worker_id.ne_all(live_worker_ids))
                        .filter(topic_subscriptions::created_at.lt(cutoff)),
                )
                .execute(&mut conn)?;

                Ok(affected as u64)
            }

            /// Backlog/lag snapshot per registered subscription. Four bounded,
            /// index-backed queries (subscription skeleton + pending/running
            /// counts + oldest-pending age + dead counts) merged in Rust — the
            /// same live+aggregate shape as `stats_all_queues`, never a full
            /// table scan. Counts are always a direct read of real state, so
            /// they cannot drift the way a maintained counter would.
            pub fn topic_backlog_stats(
                &self,
            ) -> Result<Vec<$crate::storage::SubscriptionBacklogStats>> {
                use $crate::job::JobStatus;
                use $crate::storage::schema::{dead_letter, jobs};
                let mut conn = self.conn()?;

                let subs = topic_subscriptions::table
                    .select($crate::storage::models::SubscriptionRow::as_select())
                    .load::<$crate::storage::models::SubscriptionRow>(&mut conn)?;

                // Pending + running counts, scoped to pub/sub-tagged rows only.
                let counts: Vec<(String, String, i32, i64)> = jobs::table
                    .filter(jobs::subscription_name.is_not_null())
                    .filter(
                        jobs::status.eq_any([JobStatus::Pending as i32, JobStatus::Running as i32]),
                    )
                    .group_by((jobs::topic, jobs::subscription_name, jobs::status))
                    .select((
                        jobs::topic.assume_not_null(),
                        jobs::subscription_name.assume_not_null(),
                        jobs::status,
                        diesel::dsl::count(jobs::id),
                    ))
                    .load(&mut conn)?;

                let oldest: Vec<(String, String, Option<i64>)> = jobs::table
                    .filter(jobs::subscription_name.is_not_null())
                    .filter(jobs::status.eq(JobStatus::Pending as i32))
                    .group_by((jobs::topic, jobs::subscription_name))
                    .select((
                        jobs::topic.assume_not_null(),
                        jobs::subscription_name.assume_not_null(),
                        diesel::dsl::min(jobs::created_at),
                    ))
                    .load(&mut conn)?;

                let dead: Vec<(String, String, i64)> = dead_letter::table
                    .filter(dead_letter::subscription_name.is_not_null())
                    .group_by((dead_letter::topic, dead_letter::subscription_name))
                    .select((
                        dead_letter::topic.assume_not_null(),
                        dead_letter::subscription_name.assume_not_null(),
                        diesel::dsl::count(dead_letter::id),
                    ))
                    .load(&mut conn)?;

                let subs = subs.into_iter().map(Into::into).collect();
                Ok($crate::storage::merge_backlog_stats(
                    subs, counts, oldest, dead,
                ))
            }
        }
    };
}

pub(crate) use impl_diesel_pubsub_ops;
