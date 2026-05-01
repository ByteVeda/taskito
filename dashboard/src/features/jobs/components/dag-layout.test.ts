import { describe, expect, it } from "vitest";
import type { DagData, DagNode } from "@/lib/api-types";
import { LAYER_GAP_X, layout, NODE_GAP_Y, NODE_HEIGHT, NODE_WIDTH, PADDING } from "./dag-layout";

function node(id: string): DagNode {
  return { id, task_name: id, status: "complete" };
}

describe("layout (DAG)", () => {
  it("returns zero-size canvas for an empty graph", () => {
    expect(layout({ nodes: [], edges: [] })).toEqual({ nodes: [], width: 0, height: 0 });
  });

  it("places a single node on layer 0 within padding", () => {
    const result = layout({ nodes: [node("a")], edges: [] });
    expect(result.nodes).toHaveLength(1);
    const [a] = result.nodes;
    expect(a).toMatchObject({ id: "a", layer: 0, x: PADDING });
    expect(result.width).toBe(PADDING * 2 + NODE_WIDTH);
    expect(result.height).toBe(PADDING * 2 + NODE_HEIGHT);
  });

  it("assigns BFS layers along a linear chain", () => {
    const data: DagData = {
      nodes: [node("a"), node("b"), node("c")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };
    const result = layout(data);
    const layers = Object.fromEntries(result.nodes.map((n) => [n.id, n.layer]));
    expect(layers).toEqual({ a: 0, b: 1, c: 2 });
  });

  it("centers a fan-out layer vertically", () => {
    const data: DagData = {
      nodes: [node("root"), node("l"), node("r")],
      edges: [
        { from: "root", to: "l" },
        { from: "root", to: "r" },
      ],
    };
    const result = layout(data);

    const root = result.nodes.find((n) => n.id === "root");
    const left = result.nodes.find((n) => n.id === "l");
    const right = result.nodes.find((n) => n.id === "r");
    expect(root?.layer).toBe(0);
    expect(left?.layer).toBe(1);
    expect(right?.layer).toBe(1);

    const layerHeight = 2 * NODE_HEIGHT + NODE_GAP_Y;
    const expectedStartY = (result.height - layerHeight) / 2;
    expect(left?.y).toBe(expectedStartY);
    expect(right?.y).toBe(expectedStartY + NODE_HEIGHT + NODE_GAP_Y);
  });

  it("places nodes from later layers at increasing x", () => {
    const result = layout({
      nodes: [node("a"), node("b"), node("c")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    const a = result.nodes.find((n) => n.id === "a");
    const b = result.nodes.find((n) => n.id === "b");
    const c = result.nodes.find((n) => n.id === "c");
    expect(a?.x).toBeLessThan(b?.x ?? 0);
    expect(b?.x).toBeLessThan(c?.x ?? 0);
    expect((b?.x ?? 0) - (a?.x ?? 0)).toBe(NODE_WIDTH + LAYER_GAP_X);
  });

  it("ranks deeper of two paths to a shared sink", () => {
    const data: DagData = {
      nodes: [node("a"), node("b"), node("c"), node("d")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "d" },
        { from: "a", to: "c" },
        { from: "c", to: "d" },
      ],
    };
    const result = layout(data);
    const layers = Object.fromEntries(result.nodes.map((n) => [n.id, n.layer]));
    expect(layers.d).toBe(2);
  });

  it("falls back to layer 0 for cycles with no source", () => {
    const data: DagData = {
      nodes: [node("a"), node("b")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    const result = layout(data);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.some((n) => n.layer === 0)).toBe(true);
    expect(result.width).toBeGreaterThan(0);
  });

  it("includes isolated nodes as additional layer-0 entries", () => {
    const data: DagData = {
      nodes: [node("a"), node("b"), node("orphan")],
      edges: [{ from: "a", to: "b" }],
    };
    const result = layout(data);
    const orphan = result.nodes.find((n) => n.id === "orphan");
    expect(orphan?.layer).toBe(0);
  });

  it("preserves the original task_name and status on laid-out nodes", () => {
    const data: DagData = {
      nodes: [{ id: "a", task_name: "send_email", status: "running" }],
      edges: [],
    };
    const [a] = layout(data).nodes;
    expect(a).toMatchObject({ task_name: "send_email", status: "running" });
  });
});
