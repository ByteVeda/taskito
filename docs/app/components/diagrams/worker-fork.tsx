// Worker pool — ports the prototype's `.archstack` + `.archfork` (sync OS-thread
// pool vs async pool, converging at the result channel). `architecture/worker-pool.mdx`.
export function WorkerDispatch() {
  return (
    <div className="archstack">
      <div className="layer py">
        <span className="ltag t-py">Scheduler</span>
        <div className="lbody">
          <div className="lt">Dispatch</div>
          <div className="ld">
            The Rust scheduler claims a job and routes it by task kind — sync
            tasks to the thread pool, <code>async def</code> tasks to the native
            async pool.
          </div>
        </div>
      </div>
      <div className="bound">
        <span className="bdir">↓</span>route by task kind
        <span className="bdir">↓</span>
      </div>
      <div className="archfork">
        <div className="forkcol">
          <div className="forktag">bounded mpsc · workers × N</div>
          <div className="layer py">
            <span className="ltag t-py">Sync pool</span>
            <div className="lbody">
              <div className="lt">OS-thread workers</div>
              <div className="ld">
                Each sync worker is a Rust <code>std::thread</code>. The GIL is
                acquired per task via <code>Python::with_gil()</code> —
                independent across workers.
              </div>
            </div>
          </div>
        </div>
        <div className="forkcol">
          <div className="forktag">bypasses the thread pool</div>
          <div className="layer py">
            <span className="ltag t-py">Async pool</span>
            <div className="lbody">
              <div className="lt">NativeAsyncPool</div>
              <div className="ld">
                <code>async def</code> tasks run on a dedicated event loop with
                bounded concurrency — no thread per task, no GIL contention for
                I/O-bound work.
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="bound">
        <span className="bdir">↓</span>result channel
        <span className="bdir">↓</span>
      </div>
      <div className="layer">
        <span className="ltag t-store">Store</span>
        <div className="lbody">
          <div className="lt">Result handler → SQLite</div>
          <div className="ld">
            Both pools hand results to a single result channel; the handler
            commits them (and decides retry / dead-letter) before the outcome
            surfaces.
          </div>
        </div>
      </div>
    </div>
  );
}
