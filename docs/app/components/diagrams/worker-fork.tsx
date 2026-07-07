import { SdkSwap } from "@/components/sdk-text";

// Worker pool — exact port of the prototype's `.archstack` + `.fork-route` +
// `.archfork` (scheduler routes by task type; sync OS-thread pool vs async pool).
// The per-runtime details adapt to the active SDK. `architecture/worker-pool.mdx`.
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
            <SdkSwap
              python={<code>async def</code>}
              node={<code>async</code>}
              java="handler"
            />{" "}
            functions to the async runtime.
          </div>
        </div>
        <span className="lrole">routes by task type</span>
      </div>
      <div className="fork-route">
        <SdkSwap
          python="sync def · async def"
          node="sync · async"
          java="handlers"
        />
      </div>
      <div className="archfork">
        <div className="forkcol">
          <div className="forktag">bounded mpsc · workers × 2</div>
          <div className="layer py">
            <span className="ltag t-py">Sync pool</span>
            <div className="lbody">
              <div className="lt">OS-thread workers</div>
              <div className="ld">
                <SdkSwap
                  python={
                    <>
                      Each sync worker is a Rust <code>std::thread</code>. The
                      GIL is acquired per task via{" "}
                      <code>Python::with_gil()</code> — independent across
                      workers.
                    </>
                  }
                  node={
                    <>
                      Sync handlers run on an OS-thread pool owned by the Rust
                      core — independent across workers, with no event loop to
                      block.
                    </>
                  }
                  java={
                    <>
                      Handlers run on a JVM <code>ExecutorService</code> — a
                      cached pool by default, fixed with{" "}
                      <code>concurrency(n)</code> — fed by the JNI dispatch
                      bridge.
                    </>
                  }
                />
              </div>
            </div>
          </div>
        </div>
        <div className="forkcol">
          <div className="forktag">bypasses the thread pool</div>
          <div className="layer py">
            <span className="ltag t-py">Async pool</span>
            <div className="lbody">
              <div className="lt">
                <SdkSwap
                  python="NativeAsyncPool"
                  node="Native async pool"
                  java="Executor dispatch"
                />
              </div>
              <div className="ld">
                <SdkSwap
                  python={
                    <>
                      <code>async def</code> tasks are dispatched to an{" "}
                      <code>AsyncTaskExecutor</code> on a Python daemon thread;{" "}
                      <code>PyResultSender</code> bridges results back.
                    </>
                  }
                  node={
                    <>
                      <code>async</code> handlers run on a native async pool —
                      no thread per job; each runs on your Node event loop and
                      its promise is awaited back into the core.
                    </>
                  }
                  java={
                    <>
                      Every job is an executor task; the handler's return value
                      (or exception) is bridged back into the Rust scheduler as
                      the job outcome.
                    </>
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
