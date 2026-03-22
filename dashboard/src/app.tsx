import Router from "preact-router";
import { Shell } from "./components/layout/shell";
import { ToastContainer } from "./components/ui/toast";
import { CircuitBreakers } from "./pages/circuit-breakers";
import { DeadLetters } from "./pages/dead-letters";
import { JobDetail } from "./pages/job-detail";
import { Jobs } from "./pages/jobs";
import { Logs } from "./pages/logs";
import { Metrics } from "./pages/metrics";
import { Overview } from "./pages/overview";
import { Queues } from "./pages/queues";
import { Resources } from "./pages/resources";
import { System } from "./pages/system";
import { Workers } from "./pages/workers";

export function App() {
  return (
    <Shell>
      <Router>
        <Overview path="/" />
        <Jobs path="/jobs" />
        <JobDetail path="/jobs/:id" />
        <Metrics path="/metrics" />
        <Logs path="/logs" />
        <Workers path="/workers" />
        <CircuitBreakers path="/circuit-breakers" />
        <DeadLetters path="/dead-letters" />
        <Resources path="/resources" />
        <Queues path="/queues" />
        <System path="/system" />
      </Router>
      <ToastContainer />
    </Shell>
  );
}
