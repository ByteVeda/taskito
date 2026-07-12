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
            ) -> Result<Vec<SubscriptionRow>> {
                let mut conn = self.conn()?;

                let rows = topic_subscriptions::table
                    .filter(topic_subscriptions::topic.eq(topic))
                    .filter(topic_subscriptions::active.eq(true))
                    .order((
                        topic_subscriptions::created_at.asc(),
                        topic_subscriptions::subscription_name.asc(),
                    ))
                    .select(SubscriptionRow::as_select())
                    .load(&mut conn)?;

                Ok(rows)
            }

            /// Every registered subscription, active or paused, across all topics.
            pub fn list_subscriptions(&self) -> Result<Vec<SubscriptionRow>> {
                let mut conn = self.conn()?;

                let rows = topic_subscriptions::table
                    .select(SubscriptionRow::as_select())
                    .load(&mut conn)?;

                Ok(rows)
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
        }
    };
}

pub(crate) use impl_diesel_pubsub_ops;
