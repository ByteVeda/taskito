use std::sync::Arc;

use log::{debug, info, warn};
use tokio::net::TcpListener;
use tokio::sync::Notify;

use crate::MeshNode;

use super::protocol::{read_frame, write_frame, StealRequest, StealResponse};

/// TCP server that responds to steal requests from peer workers.
pub async fn run_steal_server(mesh_node: Arc<MeshNode>, shutdown: Arc<Notify>) {
    let bind = format!(
        "{}:{}",
        mesh_node.config().bind_addr,
        mesh_node.config().steal_port
    );
    let listener = match TcpListener::bind(&bind).await {
        Ok(l) => l,
        Err(e) => {
            warn!("[mesh] failed to bind steal server on {bind}: {e}");
            return;
        }
    };
    info!("[mesh] steal server listening on {bind}");

    loop {
        tokio::select! {
            _ = shutdown.notified() => break,
            result = listener.accept() => {
                match result {
                    Ok((stream, peer)) => {
                        let node = mesh_node.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle_steal(node, stream).await {
                                debug!("[mesh] steal handler error from {peer}: {e}");
                            }
                        });
                    }
                    Err(e) => {
                        debug!("[mesh] accept error: {e}");
                    }
                }
            }
        }
    }

    info!("[mesh] steal server stopped");
}

async fn handle_steal(
    mesh_node: Arc<MeshNode>,
    mut stream: tokio::net::TcpStream,
) -> Result<(), Box<dyn std::error::Error>> {
    let (mut reader, mut writer) = stream.split();
    let frame = read_frame(&mut reader).await?;
    let req: StealRequest = bincode::deserialize(&frame)?;

    let stolen = mesh_node.give_jobs(req.max_count);
    debug!(
        "[mesh] giving {} jobs to thief {}",
        stolen.len(),
        req.thief_id
    );

    let resp = StealResponse { jobs: stolen };
    let resp_bytes = bincode::serialize(&resp)?;
    write_frame(&mut writer, &resp_bytes).await?;

    Ok(())
}
