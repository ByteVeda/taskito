package org.byteveda.taskito.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import org.byteveda.taskito.DeadJob;
import org.byteveda.taskito.Job;
import org.byteveda.taskito.JobFilter;
import org.byteveda.taskito.JobStatus;
import org.byteveda.taskito.Queue;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.dashboard.DashboardServer;
import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;

/** Command-line interface over a Taskito queue. */
@Command(
        name = "taskito",
        mixinStandardHelpOptions = true,
        subcommands = {
            Cli.Stats.class,
            Cli.Enqueue.class,
            Cli.Jobs.class,
            Cli.Cancel.class,
            Cli.Pause.class,
            Cli.Resume.class,
            Cli.Dlq.class,
            Cli.Dashboard.class
        })
public final class Cli {
    static final ObjectMapper JSON = new ObjectMapper();

    @Option(names = "--backend", description = "Storage backend (default sqlite).", defaultValue = "sqlite")
    String backend;

    @Option(names = "--url", required = true, description = "Connection string (SQLite path or URL).")
    String url;

    Queue open() {
        return Taskito.builder().backend(backend).url(url).open();
    }

    static String json(Object value) {
        try {
            return JSON.writerWithDefaultPrettyPrinter().writeValueAsString(value);
        } catch (Exception e) {
            return String.valueOf(value);
        }
    }

    public static void main(String[] args) {
        System.exit(new CommandLine(new Cli()).execute(args));
    }

    @Command(name = "stats", description = "Show job counts by status.")
    static final class Stats implements Callable<Integer> {
        @ParentCommand
        Cli parent;

        @Override
        public Integer call() {
            try (Queue queue = parent.open()) {
                System.out.println(json(queue.stats()));
            }
            return 0;
        }
    }

    @Command(name = "enqueue", description = "Enqueue a task with a JSON payload.")
    static final class Enqueue implements Callable<Integer> {
        @ParentCommand
        Cli parent;

        @Parameters(index = "0", description = "Task name.")
        String task;

        @Parameters(index = "1", arity = "0..1", description = "JSON payload (default null).")
        String payload;

        @Override
        public Integer call() throws Exception {
            Object value = payload == null ? null : JSON.readValue(payload, Object.class);
            try (Queue queue = parent.open()) {
                System.out.println(queue.enqueue(task, value));
            }
            return 0;
        }
    }

    @Command(name = "jobs", description = "List jobs.")
    static final class Jobs implements Callable<Integer> {
        @ParentCommand
        Cli parent;

        @Option(names = "--status", description = "Filter by status.")
        String status;

        @Option(names = "--queue", description = "Filter by queue.")
        String queue;

        @Option(names = "--limit", defaultValue = "50")
        int limit;

        @Override
        public Integer call() {
            JobFilter.Builder filter = JobFilter.builder().limit(limit);
            if (status != null) {
                filter.status(JobStatus.fromWire(status));
            }
            if (queue != null) {
                filter.queue(queue);
            }
            try (Queue q = parent.open()) {
                List<Job> jobs = q.listJobs(filter.build());
                System.out.println(json(jobs));
            }
            return 0;
        }
    }

    @Command(name = "cancel", description = "Cancel a pending job.")
    static final class Cancel implements Callable<Integer> {
        @ParentCommand
        Cli parent;

        @Parameters(index = "0", description = "Job id.")
        String id;

        @Override
        public Integer call() {
            try (Queue queue = parent.open()) {
                return queue.cancel(id) ? 0 : 1;
            }
        }
    }

    @Command(name = "pause", description = "Pause a queue.")
    static final class Pause implements Callable<Integer> {
        @ParentCommand
        Cli parent;

        @Parameters(index = "0", description = "Queue name.")
        String queue;

        @Override
        public Integer call() {
            try (Queue q = parent.open()) {
                q.pauseQueue(queue);
            }
            return 0;
        }
    }

    @Command(name = "resume", description = "Resume a queue.")
    static final class Resume implements Callable<Integer> {
        @ParentCommand
        Cli parent;

        @Parameters(index = "0", description = "Queue name.")
        String queue;

        @Override
        public Integer call() {
            try (Queue q = parent.open()) {
                q.resumeQueue(queue);
            }
            return 0;
        }
    }

    @Command(
            name = "dlq",
            description = "Dead-letter operations.",
            subcommands = {Dlq.ListDead.class, Dlq.Retry.class, Dlq.Delete.class})
    static final class Dlq {
        @ParentCommand
        Cli parent;

        Queue open() {
            return parent.open();
        }

        @Command(name = "list", description = "List dead-letter entries.")
        static final class ListDead implements Callable<Integer> {
            @ParentCommand
            Dlq dlq;

            @Option(names = "--limit", defaultValue = "50")
            long limit;

            @Override
            public Integer call() {
                try (Queue queue = dlq.open()) {
                    List<DeadJob> dead = queue.listDead(limit, 0);
                    System.out.println(json(dead));
                }
                return 0;
            }
        }

        @Command(name = "retry", description = "Re-enqueue a dead-letter entry.")
        static final class Retry implements Callable<Integer> {
            @ParentCommand
            Dlq dlq;

            @Parameters(index = "0", description = "Dead-letter id.")
            String id;

            @Override
            public Integer call() {
                try (Queue queue = dlq.open()) {
                    System.out.println(queue.retryDead(id));
                }
                return 0;
            }
        }

        @Command(name = "delete", description = "Delete a dead-letter entry.")
        static final class Delete implements Callable<Integer> {
            @ParentCommand
            Dlq dlq;

            @Parameters(index = "0", description = "Dead-letter id.")
            String id;

            @Override
            public Integer call() {
                try (Queue queue = dlq.open()) {
                    return queue.deleteDead(id) ? 0 : 1;
                }
            }
        }
    }

    @Command(name = "dashboard", description = "Serve the dashboard until interrupted.")
    static final class Dashboard implements Callable<Integer> {
        @ParentCommand
        Cli parent;

        @Option(names = "--port", defaultValue = "8080")
        int port;

        @Option(names = "--token", description = "Require this token for API access.")
        String token;

        @Option(names = "--static", description = "Directory of the prebuilt SPA.")
        String staticDir;

        @Override
        public Integer call() throws Exception {
            try (Queue queue = parent.open();
                    DashboardServer server = DashboardServer.start(queue, port, token, staticDir)) {
                System.out.println("dashboard on http://localhost:" + server.port());
                new CountDownLatch(1).await();
            }
            return 0;
        }
    }
}
