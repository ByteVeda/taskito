//! UI-thread state and input handling. Holds the latest snapshot of each view
//! and translates key presses into [`Cmd`]s for the worker.

use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use taskito_core::storage::QueueStats;
use taskito_core::JobStatus;

use crate::event::{Cmd, FetchReq, Msg, PendingAction};
use crate::source::{
    DeadRow, JobDetail, JobRow, StatsSnapshot, View, WorkerView, WorkflowNodeRow, WorkflowRunRow,
};

pub enum InputMode {
    Normal,
    Confirm(PendingAction),
    Help,
}

pub struct Notice {
    pub text: String,
    pub error: bool,
}

pub struct App {
    pub view: View,
    pub refresh: Duration,
    pub input: InputMode,
    pub should_quit: bool,

    pub stats: StatsSnapshot,
    pub jobs: Vec<JobRow>,
    pub job_filter: Option<JobStatus>,
    pub dead: Vec<DeadRow>,
    pub workers: Vec<WorkerView>,
    pub runs: Vec<WorkflowRunRow>,

    pub selected: usize,
    pub detail_open: bool,
    pub loading_detail: bool,
    pub job_detail: Option<JobDetail>,
    pub wf_nodes: Vec<WorkflowNodeRow>,

    pub notice: Option<Notice>,
    last_refresh: Instant,
}

impl App {
    pub fn new(refresh: Duration) -> Self {
        Self {
            view: View::Stats,
            refresh,
            input: InputMode::Normal,
            should_quit: false,
            stats: StatsSnapshot::default(),
            jobs: Vec::new(),
            job_filter: None,
            dead: Vec::new(),
            workers: Vec::new(),
            runs: Vec::new(),
            selected: 0,
            detail_open: false,
            loading_detail: false,
            job_detail: None,
            wf_nodes: Vec::new(),
            notice: None,
            last_refresh: Instant::now(),
        }
    }

    pub fn current_len(&self) -> usize {
        match self.view {
            View::Stats => self.stats.per_queue.len(),
            View::Jobs => self.jobs.len(),
            View::DeadLetters => self.dead.len(),
            View::Workers => self.workers.len(),
            View::Workflows => self.runs.len(),
        }
    }

    pub fn selected_job(&self) -> Option<&JobRow> {
        self.jobs.get(self.selected)
    }
    pub fn selected_dead(&self) -> Option<&DeadRow> {
        self.dead.get(self.selected)
    }
    pub fn selected_run(&self) -> Option<&WorkflowRunRow> {
        self.runs.get(self.selected)
    }
    pub fn selected_queue(&self) -> Option<&(String, QueueStats)> {
        self.stats.per_queue.get(self.selected)
    }

    /// Whether the given queue is currently paused (for the Stats toggle).
    pub fn is_paused(&self, queue: &str) -> bool {
        self.stats.paused.iter().any(|q| q == queue)
    }

    /// Request a fresh fetch for the active view. Always resets the refresh
    /// clock so auto-refresh and manual refresh share one cadence.
    pub fn request_active(&mut self, tx: &Sender<Cmd>) {
        self.last_refresh = Instant::now();
        let req = match self.view {
            View::Stats => FetchReq::Stats,
            View::Jobs => FetchReq::Jobs(self.job_filter),
            View::DeadLetters => FetchReq::Dead,
            View::Workers => FetchReq::Workers,
            View::Workflows => FetchReq::Runs,
        };
        let _ = tx.send(Cmd::Fetch(req));
    }

    /// Auto-refresh only when idle (not confirming, in help, or reading detail),
    /// so those interactions aren't disrupted.
    pub fn maybe_auto_refresh(&mut self, tx: &Sender<Cmd>) {
        if matches!(self.input, InputMode::Normal)
            && !self.detail_open
            && self.last_refresh.elapsed() >= self.refresh
        {
            self.request_active(tx);
        }
    }

    /// Apply a worker message. Returns `true` when a follow-up list refresh is
    /// warranted (after a successful mutation).
    pub fn apply(&mut self, msg: Msg) -> bool {
        match msg {
            Msg::Stats(s) => self.stats = s,
            Msg::Jobs(v) => self.jobs = v,
            Msg::Dead(v) => self.dead = v,
            Msg::Workers(v) => self.workers = v,
            Msg::Runs(v) => self.runs = v,
            Msg::JobDetail(d) => {
                self.job_detail = d;
                self.loading_detail = false;
            }
            Msg::WorkflowNodes(_run, nodes) => {
                self.wf_nodes = nodes;
                self.loading_detail = false;
            }
            Msg::ActionOk(text) => {
                self.notice = Some(Notice { text, error: false });
                return true;
            }
            Msg::Error(text) => {
                self.notice = Some(Notice { text, error: true });
                self.loading_detail = false;
            }
        }
        self.clamp_selection();
        false
    }

    fn clamp_selection(&mut self) {
        let len = self.current_len();
        if len == 0 {
            self.selected = 0;
        } else if self.selected >= len {
            self.selected = len - 1;
        }
    }

    pub fn on_key(&mut self, key: KeyEvent, tx: &Sender<Cmd>) {
        match &self.input {
            InputMode::Help => {
                self.input = InputMode::Normal;
            }
            InputMode::Confirm(action) => match key.code {
                KeyCode::Char('y') | KeyCode::Char('Y') | KeyCode::Enter => {
                    let _ = tx.send(Cmd::Act(action.clone()));
                    self.input = InputMode::Normal;
                }
                _ => self.input = InputMode::Normal,
            },
            InputMode::Normal => self.on_normal_key(key, tx),
        }
    }

    fn on_normal_key(&mut self, key: KeyEvent, tx: &Sender<Cmd>) {
        // Global quit.
        if key.code == KeyCode::Char('q')
            || (key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL))
        {
            // Ctrl-c always quits; bare `q` closes detail first, else quits.
            if key.code == KeyCode::Char('q') && self.detail_open {
                self.detail_open = false;
            } else {
                self.should_quit = true;
            }
            return;
        }

        match key.code {
            KeyCode::Char('?') => self.input = InputMode::Help,
            KeyCode::Esc => {
                self.detail_open = false;
            }
            KeyCode::Tab | KeyCode::Right => self.switch_view(1, tx),
            KeyCode::BackTab | KeyCode::Left => self.switch_view(-1, tx),
            KeyCode::Char(c @ '1'..='5') => {
                let idx = c as usize - '1' as usize;
                self.set_view(View::ALL[idx], tx);
            }
            KeyCode::Char('r') => self.request_active(tx),
            KeyCode::Char('j') | KeyCode::Down => self.move_selection(1),
            KeyCode::Char('k') | KeyCode::Up => self.move_selection(-1),
            KeyCode::Char('g') => self.selected = 0,
            KeyCode::Char('G') => self.selected = self.current_len().saturating_sub(1),
            KeyCode::Enter => self.open_detail(tx),
            _ => self.on_view_action_key(key, tx),
        }
    }

    fn on_view_action_key(&mut self, key: KeyEvent, tx: &Sender<Cmd>) {
        if self.detail_open {
            return;
        }
        match self.view {
            View::Jobs => match key.code {
                KeyCode::Char('f') => {
                    self.job_filter = cycle_filter(self.job_filter);
                    self.selected = 0;
                    self.request_active(tx);
                }
                KeyCode::Char('c') => {
                    if let Some(job) = self.selected_job() {
                        let running = job.status == JobStatus::Running;
                        self.confirm(PendingAction::CancelJob {
                            id: job.id.clone(),
                            running,
                        });
                    }
                }
                KeyCode::Char('R') => {
                    if let Some(job) = self.selected_job() {
                        self.confirm(PendingAction::ReplayJob { id: job.id.clone() });
                    }
                }
                _ => {}
            },
            View::DeadLetters => match key.code {
                KeyCode::Char('T') | KeyCode::Char('t') => {
                    if let Some(d) = self.selected_dead() {
                        self.confirm(PendingAction::RetryDead { id: d.id.clone() });
                    }
                }
                KeyCode::Char('d') => {
                    if let Some(d) = self.selected_dead() {
                        self.confirm(PendingAction::DeleteDead { id: d.id.clone() });
                    }
                }
                KeyCode::Char('P') if !self.dead.is_empty() => {
                    self.confirm(PendingAction::PurgeDead);
                }
                _ => {}
            },
            View::Stats => {
                if key.code == KeyCode::Char('p') {
                    if let Some((queue, _)) = self.selected_queue() {
                        let queue = queue.clone();
                        let action = if self.is_paused(&queue) {
                            PendingAction::ResumeQueue(queue)
                        } else {
                            PendingAction::PauseQueue(queue)
                        };
                        self.confirm(action);
                    }
                }
            }
            View::Workers | View::Workflows => {}
        }
    }

    fn confirm(&mut self, action: PendingAction) {
        self.input = InputMode::Confirm(action);
    }

    fn move_selection(&mut self, delta: i32) {
        let len = self.current_len();
        if len == 0 {
            return;
        }
        let next = self.selected as i32 + delta;
        self.selected = next.clamp(0, len as i32 - 1) as usize;
    }

    fn switch_view(&mut self, delta: i32, tx: &Sender<Cmd>) {
        let cur = View::ALL.iter().position(|v| *v == self.view).unwrap_or(0);
        let len = View::ALL.len() as i32;
        let idx = ((cur as i32 + delta) % len + len) % len;
        self.set_view(View::ALL[idx as usize], tx);
    }

    fn set_view(&mut self, view: View, tx: &Sender<Cmd>) {
        if view == self.view {
            return;
        }
        self.view = view;
        self.selected = 0;
        self.detail_open = false;
        self.request_active(tx);
    }

    fn open_detail(&mut self, tx: &Sender<Cmd>) {
        // Clone the id first so the selection borrow ends before we mutate self.
        match self.view {
            View::Jobs => {
                if let Some(id) = self.selected_job().map(|j| j.id.clone()) {
                    self.job_detail = None;
                    self.loading_detail = true;
                    self.detail_open = true;
                    let _ = tx.send(Cmd::Fetch(FetchReq::JobDetail(id)));
                }
            }
            View::Workflows => {
                if let Some(id) = self.selected_run().map(|r| r.id.clone()) {
                    self.wf_nodes = Vec::new();
                    self.loading_detail = true;
                    self.detail_open = true;
                    let _ = tx.send(Cmd::Fetch(FetchReq::WorkflowNodes(id)));
                }
            }
            View::DeadLetters => {
                if self.selected_dead().is_some() {
                    self.detail_open = true;
                }
            }
            View::Stats | View::Workers => {}
        }
    }
}

fn cycle_filter(current: Option<JobStatus>) -> Option<JobStatus> {
    match current {
        None => Some(JobStatus::Pending),
        Some(JobStatus::Pending) => Some(JobStatus::Running),
        Some(JobStatus::Running) => Some(JobStatus::Complete),
        Some(JobStatus::Complete) => Some(JobStatus::Failed),
        Some(JobStatus::Failed) => Some(JobStatus::Dead),
        Some(JobStatus::Dead) => Some(JobStatus::Cancelled),
        Some(JobStatus::Cancelled) => None,
    }
}
