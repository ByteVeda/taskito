//! Child process handle — spawn, write jobs, read results.
//!
//! A child is split into two halves after spawning:
//! - `ChildWriter`: sends jobs to the child's stdin (owned by dispatch thread)
//! - `ChildReader`: reads results from the child's stdout (owned by reader thread)
//! - `ChildProcess`: holds the process handle for lifecycle management

use std::io::{BufRead, BufReader, BufWriter, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use super::protocol::{ChildMessage, ParentMessage};

/// Writer half — sends job messages to the child process via stdin.
pub struct ChildWriter {
    writer: BufWriter<ChildStdin>,
}

impl ChildWriter {
    /// Send a message to the child process.
    pub fn send(&mut self, msg: &ParentMessage) -> std::io::Result<()> {
        let json = serde_json::to_string(msg)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
        self.writer.write_all(json.as_bytes())?;
        self.writer.write_all(b"\n")?;
        self.writer.flush()
    }

    /// Send a shutdown message. Errors are silently ignored (child may already be gone).
    pub fn send_shutdown(&mut self) {
        let _ = self.send(&ParentMessage::Shutdown);
    }
}

/// Reader half — reads result messages from the child process via stdout.
pub struct ChildReader {
    reader: BufReader<ChildStdout>,
}

impl ChildReader {
    /// Read one message from the child's stdout. Blocks until a line is available.
    pub fn read(&mut self) -> Result<ChildMessage, String> {
        let mut line = String::new();
        match self.reader.read_line(&mut line) {
            Ok(0) => Err("child process closed stdout".into()),
            Ok(_) => serde_json::from_str(&line)
                .map_err(|e| format!("failed to parse child message: {e}")),
            Err(e) => Err(format!("failed to read from child stdout: {e}")),
        }
    }
}

/// Process handle for lifecycle management.
pub struct ChildProcess {
    process: Child,
}

impl ChildProcess {
    /// Check if the child process is still alive.
    #[allow(dead_code)]
    pub fn is_alive(&mut self) -> bool {
        matches!(self.process.try_wait(), Ok(None))
    }

    /// Wait for the child to exit, with a timeout. Kills if it doesn't exit in time.
    pub fn wait_or_kill(&mut self, timeout: std::time::Duration) {
        let start = std::time::Instant::now();
        loop {
            match self.process.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if start.elapsed() >= timeout => {
                    let _ = self.process.kill();
                    let _ = self.process.wait();
                    return;
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
                Err(_) => return,
            }
        }
    }
}

/// Spawn a child worker process and wait for its `ready` signal.
///
/// Returns the three split halves: writer, reader, and process handle.
pub fn spawn_child(
    python: &str,
    app_path: &str,
) -> Result<(ChildWriter, ChildReader, ChildProcess), String> {
    let mut process = Command::new(python)
        .args(["-m", "taskito.prefork", app_path])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn child: {e}"))?;

    let stdin = process.stdin.take().expect("stdin should be piped");
    let stdout = process.stdout.take().expect("stdout should be piped");

    let mut reader = ChildReader {
        reader: BufReader::new(stdout),
    };

    // Wait for ready signal
    match reader.read()? {
        ChildMessage::Ready => {}
        other => {
            return Err(format!(
                "expected ready message, got: {:?}",
                std::any::type_name_of_val(&other)
            ));
        }
    }

    Ok((
        ChildWriter {
            writer: BufWriter::new(stdin),
        },
        reader,
        ChildProcess { process },
    ))
}
