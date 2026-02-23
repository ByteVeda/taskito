diesel::table! {
    jobs (id) {
        id -> Text,
        queue -> Text,
        task_name -> Text,
        payload -> Binary,
        status -> Integer,
        priority -> Integer,
        created_at -> BigInt,
        scheduled_at -> BigInt,
        started_at -> Nullable<BigInt>,
        completed_at -> Nullable<BigInt>,
        retry_count -> Integer,
        max_retries -> Integer,
        result -> Nullable<Binary>,
        error -> Nullable<Text>,
        timeout_ms -> BigInt,
        unique_key -> Nullable<Text>,
        progress -> Nullable<Integer>,
        metadata -> Nullable<Text>,
    }
}

diesel::table! {
    dead_letter (id) {
        id -> Text,
        original_job_id -> Text,
        queue -> Text,
        task_name -> Text,
        payload -> Binary,
        error -> Nullable<Text>,
        retry_count -> Integer,
        failed_at -> BigInt,
        metadata -> Nullable<Text>,
    }
}

diesel::table! {
    rate_limits (key) {
        key -> Text,
        tokens -> Double,
        max_tokens -> Double,
        refill_rate -> Double,
        last_refill -> BigInt,
    }
}

diesel::table! {
    periodic_tasks (name) {
        name -> Text,
        task_name -> Text,
        cron_expr -> Text,
        args -> Nullable<Binary>,
        kwargs -> Nullable<Binary>,
        queue -> Text,
        enabled -> Bool,
        last_run -> Nullable<BigInt>,
        next_run -> BigInt,
    }
}

diesel::table! {
    job_errors (id) {
        id -> Text,
        job_id -> Text,
        attempt -> Integer,
        error -> Text,
        failed_at -> BigInt,
    }
}
