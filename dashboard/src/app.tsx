import Router from "preact-router";
import { Shell } from "./components/layout/shell";
import { Overview } from "./pages/overview";
import { Jobs } from "./pages/jobs";
import { JobDetail } from "./pages/job-detail";
import { Metrics } from "./pages/metrics";
import { Logs } from "./pages/logs";
import { Workers } from "./pages/workers";
import { CircuitBreakers } from "./pages/circuit-breakers";
import { DeadLetters } from "./pages/dead-letters";
import { Resources } from "./pages/resources";
import { Queues } from "./pages/queues";
import { System } from "./pages/system";
import { ToastContainer } from "./components/ui/toast";

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
