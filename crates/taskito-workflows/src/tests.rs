use taskito_core::job::now_millis;
use taskito_core::storage::sqlite::SqliteStorage;

use crate::sqlite_store::WorkflowSqliteStorage;
use crate::storage::WorkflowStorage;
use crate::*;

fn test_storage() -> WorkflowSqliteStorage {
    let base = SqliteStorage::in_memory().unwrap();
    WorkflowSqliteStorage::new(base).unwrap()
}

fn make_definition(name: &str) -> WorkflowDefinition {
    let mut step_metadata = std::collections::HashMap::new();
    step_metadata.insert(
        "a".to_string(),
        StepMetadata {
            task_name: "task_a".to_string(),
            queue: None,
            args_template: None,
            kwargs_template: None,
            max_retries: None,
            timeout_ms: None,
            priority: None,
            fan_out: None,
            fan_in: None,
            condition: None,
        },
    );
    step_metadata.insert(
        "b".to_string(),
        StepMetadata {
            task_name: "task_b".to_string(),
            queue: None,
            args_template: None,
            kwargs_template: None,
            max_retries: None,
            timeout_ms: None,
            priority: None,
            fan_out: None,
            fan_in: None,
            condition: None,
        },
    );
    step_metadata.insert(
        "c".to_string(),
        StepMetadata {
            task_name: "task_c".to_string(),
            queue: None,
            args_template: None,
            kwargs_template: None,
            max_retries: None,
            timeout_ms: None,
            priority: None,
            fan_out: None,
            fan_in: None,
            condition: None,
        },
    );

    // Simple DAG: a → b → c
    let dag_json = serde_json::json!({
        "nodes": [
            {"name": "a"},
            {"name": "b"},
            {"name": "c"}
        ],
        "edges": [
            {"from": "a", "to": "b", "weight": 1.0},
            {"from": "b", "to": "c", "weight": 1.0}
        ]
    });

    WorkflowDefinition {
        id: uuid::Uuid::now_v7().to_string(),
        name: name.to_string(),
        version: 1,
        dag_data: serde_json::to_vec(&dag_json).unwrap(),
        step_metadata,
        created_at: now_millis(),
    }
}

fn make_run(definition_id: &str) -> WorkflowRun {
    WorkflowRun {
        id: uuid::Uuid::now_v7().to_string(),
        definition_id: definition_id.to_string(),
        params: Some(r#"{"region":"eu"}"#.to_string()),
        state: WorkflowState::Pending,
        started_at: None,
        completed_at: None,
        error: None,
        parent_run_id: None,
        parent_node_name: None,
        created_at: now_millis(),
    }
}

fn make_node(run_id: &str, name: &str) -> WorkflowNode {
    WorkflowNode {
        id: uuid::Uuid::now_v7().to_string(),
        run_id: run_id.to_string(),
        node_name: name.to_string(),
        job_id: None,
        status: WorkflowNodeStatus::Pending,
        result_hash: None,
        fan_out_count: None,
        fan_in_data: None,
        started_at: None,
        completed_at: None,
        error: None,
    }
}

// ── Definition tests ─────────────────────────────────────────

#[test]
fn test_create_and_get_definition() {
    let storage = test_storage();
    let def = make_definition("my_pipeline");

    storage.create_workflow_definition(&def).unwrap();

    let fetched = storage
        .get_workflow_definition("my_pipeline", None)
        .unwrap()
        .unwrap();
    assert_eq!(fetched.name, "my_pipeline");
    assert_eq!(fetched.version, 1);
    assert_eq!(fetched.step_metadata.len(), 3);
    assert!(fetched.step_metadata.contains_key("a"));
}

#[test]
fn test_get_definition_by_version() {
    let storage = test_storage();

    let mut def_v1 = make_definition("versioned");
    def_v1.version = 1;
    storage.create_workflow_definition(&def_v1).unwrap();

    let mut def_v2 = make_definition("versioned");
    def_v2.id = uuid::Uuid::now_v7().to_string();
    def_v2.version = 2;
    storage.create_workflow_definition(&def_v2).unwrap();

    // Latest version (no version specified) returns v2
    let latest = storage
        .get_workflow_definition("versioned", None)
        .unwrap()
        .unwrap();
    assert_eq!(latest.version, 2);

    // Specific version
    let v1 = storage
        .get_workflow_definition("versioned", Some(1))
        .unwrap()
        .unwrap();
    assert_eq!(v1.version, 1);
}

#[test]
fn test_get_definition_by_id() {
    let storage = test_storage();
    let def = make_definition("by_id_test");
    let def_id = def.id.clone();
    storage.create_workflow_definition(&def).unwrap();

    let fetched = storage
        .get_workflow_definition_by_id(&def_id)
        .unwrap()
        .unwrap();
    assert_eq!(fetched.id, def_id);
}

#[test]
fn test_definition_not_found() {
    let storage = test_storage();
    let result = storage
        .get_workflow_definition("nonexistent", None)
        .unwrap();
    assert!(result.is_none());
}

// ── Run tests ────────────────────────────────────────────────

#[test]
fn test_create_and_get_run() {
    let storage = test_storage();
    let def = make_definition("run_test");
    storage.create_workflow_definition(&def).unwrap();

    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    let fetched = storage.get_workflow_run(&run_id).unwrap().unwrap();
    assert_eq!(fetched.id, run_id);
    assert_eq!(fetched.state, WorkflowState::Pending);
    assert_eq!(fetched.params, Some(r#"{"region":"eu"}"#.to_string()));
}

#[test]
fn test_update_run_state() {
    let storage = test_storage();
    let def = make_definition("state_test");
    storage.create_workflow_definition(&def).unwrap();

    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    // Pending → Running
    storage
        .update_workflow_run_state(&run_id, WorkflowState::Running, None)
        .unwrap();
    let fetched = storage.get_workflow_run(&run_id).unwrap().unwrap();
    assert_eq!(fetched.state, WorkflowState::Running);

    // Running → Failed with error
    storage
        .update_workflow_run_state(&run_id, WorkflowState::Failed, Some("node X blew up"))
        .unwrap();
    let fetched = storage.get_workflow_run(&run_id).unwrap().unwrap();
    assert_eq!(fetched.state, WorkflowState::Failed);
    assert_eq!(fetched.error, Some("node X blew up".to_string()));
}

#[test]
fn test_set_run_started_and_completed() {
    let storage = test_storage();
    let def = make_definition("timing_test");
    storage.create_workflow_definition(&def).unwrap();

    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    let start_time = now_millis();
    storage
        .set_workflow_run_started(&run_id, start_time)
        .unwrap();
    let fetched = storage.get_workflow_run(&run_id).unwrap().unwrap();
    assert_eq!(fetched.state, WorkflowState::Running);
    assert_eq!(fetched.started_at, Some(start_time));

    let end_time = now_millis();
    storage
        .set_workflow_run_completed(&run_id, end_time)
        .unwrap();
    let fetched = storage.get_workflow_run(&run_id).unwrap().unwrap();
    assert_eq!(fetched.completed_at, Some(end_time));
}

#[test]
fn test_list_runs() {
    let storage = test_storage();
    let def = make_definition("list_test");
    storage.create_workflow_definition(&def).unwrap();

    for _ in 0..5 {
        storage.create_workflow_run(&make_run(&def.id)).unwrap();
    }

    let all = storage.list_workflow_runs(None, None, 100, 0).unwrap();
    assert_eq!(all.len(), 5);

    let limited = storage.list_workflow_runs(None, None, 2, 0).unwrap();
    assert_eq!(limited.len(), 2);

    let offset = storage.list_workflow_runs(None, None, 100, 3).unwrap();
    assert_eq!(offset.len(), 2);
}

#[test]
fn test_list_runs_by_state() {
    let storage = test_storage();
    let def = make_definition("state_filter");
    storage.create_workflow_definition(&def).unwrap();

    let run1 = make_run(&def.id);
    let run1_id = run1.id.clone();
    storage.create_workflow_run(&run1).unwrap();

    let run2 = make_run(&def.id);
    storage.create_workflow_run(&run2).unwrap();

    storage
        .update_workflow_run_state(&run1_id, WorkflowState::Running, None)
        .unwrap();

    let running = storage
        .list_workflow_runs(None, Some(WorkflowState::Running), 100, 0)
        .unwrap();
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].id, run1_id);

    let pending = storage
        .list_workflow_runs(None, Some(WorkflowState::Pending), 100, 0)
        .unwrap();
    assert_eq!(pending.len(), 1);
}

// ── Node tests ───────────────────────────────────────────────

#[test]
fn test_create_and_get_node() {
    let storage = test_storage();
    let def = make_definition("node_test");
    storage.create_workflow_definition(&def).unwrap();
    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    let node = make_node(&run_id, "a");
    storage.create_workflow_node(&node).unwrap();

    let fetched = storage.get_workflow_node(&run_id, "a").unwrap().unwrap();
    assert_eq!(fetched.node_name, "a");
    assert_eq!(fetched.status, WorkflowNodeStatus::Pending);
    assert!(fetched.job_id.is_none());
}

#[test]
fn test_create_nodes_batch() {
    let storage = test_storage();
    let def = make_definition("batch_test");
    storage.create_workflow_definition(&def).unwrap();
    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    let nodes = vec![
        make_node(&run_id, "a"),
        make_node(&run_id, "b"),
        make_node(&run_id, "c"),
    ];
    storage.create_workflow_nodes_batch(&nodes).unwrap();

    let all = storage.get_workflow_nodes(&run_id).unwrap();
    assert_eq!(all.len(), 3);
}

#[test]
fn test_update_node_status() {
    let storage = test_storage();
    let def = make_definition("status_test");
    storage.create_workflow_definition(&def).unwrap();
    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();
    storage
        .create_workflow_node(&make_node(&run_id, "a"))
        .unwrap();

    storage
        .update_workflow_node_status(&run_id, "a", WorkflowNodeStatus::Running)
        .unwrap();
    let fetched = storage.get_workflow_node(&run_id, "a").unwrap().unwrap();
    assert_eq!(fetched.status, WorkflowNodeStatus::Running);
}

#[test]
fn test_set_node_job_and_timing() {
    let storage = test_storage();
    let def = make_definition("job_test");
    storage.create_workflow_definition(&def).unwrap();
    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();
    storage
        .create_workflow_node(&make_node(&run_id, "a"))
        .unwrap();

    storage
        .set_workflow_node_job(&run_id, "a", "job-123")
        .unwrap();
    let fetched = storage.get_workflow_node(&run_id, "a").unwrap().unwrap();
    assert_eq!(fetched.job_id, Some("job-123".to_string()));

    let start = now_millis();
    storage
        .set_workflow_node_started(&run_id, "a", start)
        .unwrap();
    let fetched = storage.get_workflow_node(&run_id, "a").unwrap().unwrap();
    assert_eq!(fetched.status, WorkflowNodeStatus::Running);
    assert_eq!(fetched.started_at, Some(start));

    let end = now_millis();
    storage
        .set_workflow_node_completed(&run_id, "a", end, Some("abc123"))
        .unwrap();
    let fetched = storage.get_workflow_node(&run_id, "a").unwrap().unwrap();
    assert_eq!(fetched.status, WorkflowNodeStatus::Completed);
    assert_eq!(fetched.completed_at, Some(end));
    assert_eq!(fetched.result_hash, Some("abc123".to_string()));
}

#[test]
fn test_set_node_error() {
    let storage = test_storage();
    let def = make_definition("error_test");
    storage.create_workflow_definition(&def).unwrap();
    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();
    storage
        .create_workflow_node(&make_node(&run_id, "a"))
        .unwrap();

    storage
        .set_workflow_node_error(&run_id, "a", "kaboom")
        .unwrap();
    let fetched = storage.get_workflow_node(&run_id, "a").unwrap().unwrap();
    assert_eq!(fetched.status, WorkflowNodeStatus::Failed);
    assert_eq!(fetched.error, Some("kaboom".to_string()));
}

// ── Ready nodes (DAG-aware) ──────────────────────────────────

#[test]
fn test_get_ready_nodes_roots_are_ready() {
    let storage = test_storage();
    let def = make_definition("ready_test");
    let dag_json = String::from_utf8(def.dag_data.clone()).unwrap();
    storage.create_workflow_definition(&def).unwrap();

    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    let nodes = vec![
        make_node(&run_id, "a"),
        make_node(&run_id, "b"),
        make_node(&run_id, "c"),
    ];
    storage.create_workflow_nodes_batch(&nodes).unwrap();

    // Only root node "a" should be ready (b depends on a, c depends on b)
    let ready = storage
        .get_ready_workflow_nodes(&run_id, &dag_json)
        .unwrap();
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].node_name, "a");
}

#[test]
fn test_get_ready_nodes_after_completion() {
    let storage = test_storage();
    let def = make_definition("completion_ready");
    let dag_json = String::from_utf8(def.dag_data.clone()).unwrap();
    storage.create_workflow_definition(&def).unwrap();

    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    storage
        .create_workflow_nodes_batch(&[
            make_node(&run_id, "a"),
            make_node(&run_id, "b"),
            make_node(&run_id, "c"),
        ])
        .unwrap();

    // Complete "a" → "b" becomes ready
    storage
        .set_workflow_node_completed(&run_id, "a", now_millis(), None)
        .unwrap();

    let ready = storage
        .get_ready_workflow_nodes(&run_id, &dag_json)
        .unwrap();
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].node_name, "b");
}

#[test]
fn test_get_ready_nodes_all_completed() {
    let storage = test_storage();
    let def = make_definition("all_done");
    let dag_json = String::from_utf8(def.dag_data.clone()).unwrap();
    storage.create_workflow_definition(&def).unwrap();

    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    storage
        .create_workflow_nodes_batch(&[
            make_node(&run_id, "a"),
            make_node(&run_id, "b"),
            make_node(&run_id, "c"),
        ])
        .unwrap();

    // Complete all
    for name in &["a", "b", "c"] {
        storage
            .set_workflow_node_completed(&run_id, name, now_millis(), None)
            .unwrap();
    }

    let ready = storage
        .get_ready_workflow_nodes(&run_id, &dag_json)
        .unwrap();
    assert!(ready.is_empty());
}

#[test]
fn test_get_ready_nodes_diamond_dag() {
    let storage = test_storage();

    // Diamond: a → b, a → c, b → d, c → d
    let dag_json = serde_json::json!({
        "nodes": [{"name": "a"}, {"name": "b"}, {"name": "c"}, {"name": "d"}],
        "edges": [
            {"from": "a", "to": "b", "weight": 1.0},
            {"from": "a", "to": "c", "weight": 1.0},
            {"from": "b", "to": "d", "weight": 1.0},
            {"from": "c", "to": "d", "weight": 1.0}
        ]
    });

    let mut step_meta = std::collections::HashMap::new();
    for name in &["a", "b", "c", "d"] {
        step_meta.insert(
            name.to_string(),
            StepMetadata {
                task_name: format!("task_{name}"),
                queue: None,
                args_template: None,
                kwargs_template: None,
                max_retries: None,
                timeout_ms: None,
                priority: None,
                fan_out: None,
                fan_in: None,
                condition: None,
            },
        );
    }

    let def = WorkflowDefinition {
        id: uuid::Uuid::now_v7().to_string(),
        name: "diamond".to_string(),
        version: 1,
        dag_data: serde_json::to_vec(&dag_json).unwrap(),
        step_metadata: step_meta,
        created_at: now_millis(),
    };
    let dag_str = serde_json::to_string(&dag_json).unwrap();
    storage.create_workflow_definition(&def).unwrap();

    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    for name in &["a", "b", "c", "d"] {
        storage
            .create_workflow_node(&make_node(&run_id, name))
            .unwrap();
    }

    // Initially only "a" is ready
    let ready = storage.get_ready_workflow_nodes(&run_id, &dag_str).unwrap();
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].node_name, "a");

    // Complete "a" → "b" and "c" become ready (parallel)
    storage
        .set_workflow_node_completed(&run_id, "a", now_millis(), None)
        .unwrap();
    let ready = storage.get_ready_workflow_nodes(&run_id, &dag_str).unwrap();
    assert_eq!(ready.len(), 2);
    let names: Vec<&str> = ready.iter().map(|n| n.node_name.as_str()).collect();
    assert!(names.contains(&"b"));
    assert!(names.contains(&"c"));

    // Complete only "b" → "d" NOT ready yet (needs "c" too)
    storage
        .set_workflow_node_completed(&run_id, "b", now_millis(), None)
        .unwrap();
    let ready = storage.get_ready_workflow_nodes(&run_id, &dag_str).unwrap();
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].node_name, "c"); // only c is pending+ready

    // Complete "c" → "d" becomes ready
    storage
        .set_workflow_node_completed(&run_id, "c", now_millis(), None)
        .unwrap();
    let ready = storage.get_ready_workflow_nodes(&run_id, &dag_str).unwrap();
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].node_name, "d");
}

// ── WorkflowState transition tests ───────────────────────────

#[test]
fn test_state_transitions() {
    assert!(WorkflowState::Pending.can_transition_to(WorkflowState::Running));
    assert!(WorkflowState::Running.can_transition_to(WorkflowState::Completed));
    assert!(WorkflowState::Running.can_transition_to(WorkflowState::Failed));
    assert!(WorkflowState::Running.can_transition_to(WorkflowState::Cancelled));
    assert!(WorkflowState::Running.can_transition_to(WorkflowState::Paused));
    assert!(WorkflowState::Paused.can_transition_to(WorkflowState::Running));
    assert!(WorkflowState::Paused.can_transition_to(WorkflowState::Cancelled));

    // Invalid transitions
    assert!(!WorkflowState::Pending.can_transition_to(WorkflowState::Completed));
    assert!(!WorkflowState::Completed.can_transition_to(WorkflowState::Running));
    assert!(!WorkflowState::Failed.can_transition_to(WorkflowState::Running));
}

#[test]
fn test_state_is_terminal() {
    assert!(WorkflowState::Completed.is_terminal());
    assert!(WorkflowState::Failed.is_terminal());
    assert!(WorkflowState::Cancelled.is_terminal());
    assert!(!WorkflowState::Pending.is_terminal());
    assert!(!WorkflowState::Running.is_terminal());
    assert!(!WorkflowState::Paused.is_terminal());
}

// ── Fan-out storage tests ───────────────────────────────────

#[test]
fn test_set_fan_out_count() {
    let storage = test_storage();
    let def = make_definition("fanout_pipe");
    storage.create_workflow_definition(&def).unwrap();
    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    let node = make_node(&run_id, "process");
    storage.create_workflow_node(&node).unwrap();

    // Initially pending, no fan_out_count
    let fetched = storage
        .get_workflow_node(&run_id, "process")
        .unwrap()
        .unwrap();
    assert_eq!(fetched.status, WorkflowNodeStatus::Pending);
    assert_eq!(fetched.fan_out_count, None);

    // Set fan_out_count → status transitions to Running
    storage
        .set_workflow_node_fan_out_count(&run_id, "process", 5)
        .unwrap();

    let fetched = storage
        .get_workflow_node(&run_id, "process")
        .unwrap()
        .unwrap();
    assert_eq!(fetched.status, WorkflowNodeStatus::Running);
    assert_eq!(fetched.fan_out_count, Some(5));
}

#[test]
fn test_get_nodes_by_prefix() {
    let storage = test_storage();
    let def = make_definition("prefix_pipe");
    storage.create_workflow_definition(&def).unwrap();
    let run = make_run(&def.id);
    let run_id = run.id.clone();
    storage.create_workflow_run(&run).unwrap();

    // Create parent and children
    for name in &[
        "process",
        "process[0]",
        "process[1]",
        "process[2]",
        "aggregate",
    ] {
        storage
            .create_workflow_node(&make_node(&run_id, name))
            .unwrap();
    }

    // Prefix "process[" should return only the children
    let children = storage
        .get_workflow_nodes_by_prefix(&run_id, "process[")
        .unwrap();
    assert_eq!(children.len(), 3);
    let names: Vec<&str> = children.iter().map(|n| n.node_name.as_str()).collect();
    assert!(names.contains(&"process[0]"));
    assert!(names.contains(&"process[1]"));
    assert!(names.contains(&"process[2]"));

    // Prefix "aggregate" should match just the one node
    let agg = storage
        .get_workflow_nodes_by_prefix(&run_id, "aggregate")
        .unwrap();
    assert_eq!(agg.len(), 1);

    // Prefix "nonexistent[" should return nothing
    let empty = storage
        .get_workflow_nodes_by_prefix(&run_id, "nonexistent[")
        .unwrap();
    assert!(empty.is_empty());
}
