import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Taskito — one queue, Python and Node" },
    {
      name: "description",
      content:
        "Rust-powered task queue for Python and Node.js. No broker required.",
    },
  ];
}

export default function Home() {
  return (
    <main className="landing-stub">
      <h1>Taskito</h1>
      <p>One queue. Python and Node.</p>
    </main>
  );
}
