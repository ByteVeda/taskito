// Worker pool — exact port of the prototype's `.archstack` + `.fork-route` +
// `.archfork` (scheduler routes by task type; sync OS-thread pool vs async pool).
// `architecture/worker-pool.mdx`.
export function WorkerDispatch() {
  return (
    <div className="archstack">
      <div className="layer rust">
        <span className="ltag t-rust">Rust</span>
        <div className="lbody">
          <div className="lt">Scheduler</div>
          <div className="ld">
            Dequeues a job, applies rate limits, then routes it{" "}
            <b>by task type</b> — sync functions to the thread pool,{" "}
            <code>async def</code> functions to the async runtime.
          </div>
        </div>
        <span className="lrole">routes by task type</span>
      </div>
      <div className="fork-route">sync def &nbsp;·&nbsp; async def</div>
      <div className="archfork">
        <div className="forkcol">
          <div className="forktag">bounded mpsc · workers × 2</div>
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
                <code>async def</code> tasks are dispatched to an{" "}
                <code>AsyncTaskExecutor</code> on a Python daemon thread;{" "}
                <code>PyResultSender</code> bridges results back.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
