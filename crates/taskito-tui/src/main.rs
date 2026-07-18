mod app;
mod backend;
mod cli;
mod event;
mod source;
mod ui;
mod util;

use std::io::{self, Stdout};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

use anyhow::Result;
use clap::Parser;
use crossterm::event::{self as cevent, Event, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

use crate::app::App;
use crate::event::{spawn_worker, Cmd, Msg};
use crate::source::db::DbSource;

type Term = Terminal<CrosstermBackend<Stdout>>;

fn main() -> Result<()> {
    let cli = cli::Cli::parse();
    let source = DbSource::new(backend::open(&cli.db)?);

    let (cmd_tx, cmd_rx) = mpsc::channel::<Cmd>();
    let (msg_tx, msg_rx) = mpsc::channel::<Msg>();
    let worker = spawn_worker(Box::new(source), cmd_rx, msg_tx);

    let mut terminal = setup_terminal()?;
    let mut app = App::new(Duration::from_millis(cli.refresh));
    app.request_active(&cmd_tx); // initial load for the default view

    let res = run(&mut terminal, &mut app, &cmd_tx, &msg_rx);

    restore_terminal(&mut terminal)?;
    let _ = cmd_tx.send(Cmd::Shutdown);
    let _ = worker.join();
    res
}

fn run(
    terminal: &mut Term,
    app: &mut App,
    cmd_tx: &Sender<Cmd>,
    msg_rx: &Receiver<Msg>,
) -> Result<()> {
    let poll = Duration::from_millis(100);
    while !app.should_quit {
        terminal.draw(|f| ui::draw(f, app))?;

        if cevent::poll(poll)? {
            // Only react to key *presses* — Windows also emits Release/Repeat.
            if let Event::Key(key) = cevent::read()? {
                if key.kind == KeyEventKind::Press {
                    app.on_key(key, cmd_tx);
                }
            }
        }

        while let Ok(msg) = msg_rx.try_recv() {
            if app.apply(msg) {
                app.request_active(cmd_tx); // refresh the list after a mutation
            }
        }

        app.maybe_auto_refresh(cmd_tx);
    }
    Ok(())
}

fn setup_terminal() -> Result<Term> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    Ok(Terminal::new(CrosstermBackend::new(stdout))?)
}

fn restore_terminal(terminal: &mut Term) -> Result<()> {
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}
