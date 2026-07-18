//! Detail pane for the Jobs, Workflows, and Dead-Letters views.

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;

use super::{job_status_style, wf_node_style};
use crate::app::App;
use crate::source::{JobDetail, View};
use crate::util::{fmt_age, fmt_age_opt};

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let (title, lines) = match app.view {
        View::Jobs => (" Job ", job_lines(app)),
        View::Workflows => (" Workflow Nodes ", workflow_lines(app)),
        View::DeadLetters => (" Dead Letter ", dead_lines(app)),
        _ => (" Detail ", vec![Line::from("")]),
    };
    let para = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(title))
        .wrap(Wrap { trim: false });
    f.render_widget(para, area);
}

fn field(label: &str, value: String) -> Line<'static> {
    Line::from(vec![
        Span::styled(
            format!("{label:<11}"),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::raw(value),
    ])
}

fn section(title: &str) -> Line<'static> {
    Line::from(Span::styled(
        title.to_string(),
        Style::default()
            .fg(ratatui::style::Color::Cyan)
            .add_modifier(Modifier::BOLD),
    ))
}

fn job_lines(app: &App) -> Vec<Line<'static>> {
    if app.loading_detail {
        return vec![Line::from("loading…")];
    }
    let Some(d) = &app.job_detail else {
        return vec![Line::from("job not found")];
    };
    let JobDetail {
        row,
        metadata,
        notes,
        namespace,
        errors,
        logs,
    } = d;

    let mut lines = vec![
        field("id", row.id.clone()),
        Line::from(vec![
            Span::styled("status     ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(row.status.as_str(), job_status_style(row.status)),
            Span::raw(if row.cancel_requested {
                "  (cancel requested)"
            } else {
                ""
            }),
        ]),
        field("task", row.task_name.clone()),
        field("queue", row.queue.clone()),
        field("priority", row.priority.to_string()),
        field(
            "retries",
            format!("{}/{}", row.retry_count, row.max_retries),
        ),
        field("created", fmt_age(row.created_at)),
        field("scheduled", fmt_age(row.scheduled_at)),
        field("started", fmt_age_opt(row.started_at)),
        field("completed", fmt_age_opt(row.completed_at)),
        field("namespace", namespace.clone().unwrap_or_else(|| "-".into())),
    ];
    if let Some(m) = metadata {
        lines.push(field("metadata", m.clone()));
    }
    if let Some(n) = notes {
        lines.push(field("notes", n.clone()));
    }
    if let Some(e) = &row.error {
        lines.push(Line::from(""));
        lines.push(section("Error"));
        lines.push(Line::from(e.clone()));
    }

    if !errors.is_empty() {
        lines.push(Line::from(""));
        lines.push(section("Attempts"));
        for e in errors {
            lines.push(Line::from(format!(
                "#{} · {} · {}",
                e.attempt,
                fmt_age(e.failed_at),
                e.error
            )));
        }
    }

    if !logs.is_empty() {
        lines.push(Line::from(""));
        lines.push(section("Logs"));
        for l in logs {
            lines.push(Line::from(format!(
                "[{}] {} · {}",
                l.level,
                fmt_age(l.logged_at),
                l.message
            )));
        }
    }
    lines
}

fn workflow_lines(app: &App) -> Vec<Line<'static>> {
    if app.loading_detail {
        return vec![Line::from("loading…")];
    }
    if app.wf_nodes.is_empty() {
        return vec![Line::from("no nodes")];
    }
    let run = app.selected_run();
    let mut lines = Vec::new();
    if let Some(r) = run {
        lines.push(field("run", r.id.clone()));
        lines.push(field("definition", r.definition_id.clone()));
        lines.push(field("started", fmt_age_opt(r.started_at)));
        if let Some(parent) = &r.parent_run_id {
            lines.push(field("parent", parent.clone()));
        }
        lines.push(Line::from(""));
    }
    lines.push(section("Nodes"));
    for n in &app.wf_nodes {
        let mut spans = vec![
            Span::styled(
                format!("{:<10}", n.status.as_str()),
                wf_node_style(n.status),
            ),
            Span::raw(n.node_name.clone()),
        ];
        if let Some(job) = &n.job_id {
            spans.push(Span::styled(
                format!("  job {}", job.chars().take(8).collect::<String>()),
                Style::default().fg(ratatui::style::Color::DarkGray),
            ));
        }
        let timing = match (n.started_at, n.completed_at) {
            (Some(_), Some(c)) => format!("  done {}", fmt_age(c)),
            (Some(s), None) => format!("  started {}", fmt_age(s)),
            _ => String::new(),
        };
        if !timing.is_empty() {
            spans.push(Span::styled(
                timing,
                Style::default().fg(ratatui::style::Color::DarkGray),
            ));
        }
        lines.push(Line::from(spans));
        if let Some(err) = &n.error {
            lines.push(Line::from(Span::styled(
                format!("    {err}"),
                Style::default().fg(ratatui::style::Color::Red),
            )));
        }
    }
    lines
}

fn dead_lines(app: &App) -> Vec<Line<'static>> {
    let Some(d) = app.selected_dead() else {
        return vec![Line::from("no selection")];
    };
    let mut lines = vec![
        field("id", d.id.clone()),
        field("original", d.original_job_id.clone()),
        field("task", d.task_name.clone()),
        field("queue", d.queue.clone()),
        field("retries", d.retry_count.to_string()),
        field("dlq tries", d.dlq_retry_count.to_string()),
        field("failed", fmt_age(d.failed_at)),
        Line::from(""),
        section("Error"),
        Line::from(d.error.clone().unwrap_or_else(|| "-".into())),
    ];
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "T retry · d delete",
        Style::default().fg(ratatui::style::Color::DarkGray),
    )));
    lines
}
