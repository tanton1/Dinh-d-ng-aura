"""Local scope/provenance checks and file-level metrics; never imports Aura code."""
import hashlib
import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx
from graphify.detect import detect


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def manifest(root):
    if not (root / ".graphifyignore").is_file():
        raise SystemExit("Missing .graphifyignore: copy the reviewed project scope before building.")
    result = detect(root)
    files = sorted(Path(file).resolve() for file in result.get("files", {}).get("code", []))
    records = []
    for file in files:
        relative = file.relative_to(root).as_posix()
        if relative.split("/")[0] not in {"src", "functions"}:
            raise SystemExit(f"Out-of-scope code detected: {relative}")
        if file.suffix not in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"}:
            raise SystemExit(f"Unexpected source type: {relative}")
        records.append({"file": relative, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
    if not records:
        raise SystemExit("No application code found; refusing an empty build.")
    return {
        "sourceRoot": str(root),
        "commit": subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip(),
        "fingerprint": hashlib.sha256(json.dumps({
            "files": records,
            "scope": hashlib.sha256((root / ".graphifyignore").read_bytes()).hexdigest(),
            "auditor": hashlib.sha256((root / "scripts/audit-callable-usage.cjs").read_bytes()).hexdigest(),
            "policy": "fresh-ast-v1-graphify-0.9.97",
        }, sort_keys=True).encode()).hexdigest(),
        "fileCount": len(records),
        "files": records,
        "excludedSensitiveCount": len(result.get("skipped_sensitive", [])),
    }


def report(root, out):
    current = manifest(root)
    start = json.loads((out / "aura-build-input.json").read_text(encoding="utf-8"))
    if current["fingerprint"] != start["fingerprint"]:
        raise SystemExit("Source changed during extraction. Rebuild before using this graph.")
    graph = json.loads((out / "graph.json").read_text(encoding="utf-8"))
    nodes = graph["nodes"]
    edges = graph.get("links", graph.get("edges", []))
    by_id = {node["id"]: node for node in nodes}
    source_files = {item["file"] for item in current["files"]}
    dependencies = nx.DiGraph()
    dependencies.add_nodes_from(source_files)
    relation_counts = Counter()
    for edge in edges:
        relation = edge.get("relation", edge.get("type", "unknown"))
        relation_counts[relation] += 1
        origin = by_id.get(edge["source"], {}).get("source_file")
        target = by_id.get(edge["target"], {}).get("source_file")
        if relation == "imports" and origin in source_files and target in source_files and origin != target:
            dependencies.add_edge(origin, target)
    metrics = {
        "scope": "src and functions only; tests/scripts/docs excluded; static evidence, not live usage",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "commit": current["commit"], "fingerprint": current["fingerprint"],
        "sourceFiles": current["fileCount"], "nodes": len(nodes), "edges": len(edges),
        "relations": dict(relation_counts),
        "topSourceFilesByNodes": Counter(n.get("source_file") for n in nodes if n.get("source_file") in source_files).most_common(20),
        "importEdges": dependencies.number_of_edges(),
        "topImportedFiles": sorted(dependencies.in_degree(), key=lambda pair: (-pair[1], pair[0]))[:20],
        "topImportingFiles": sorted(dependencies.out_degree(), key=lambda pair: (-pair[1], pair[0]))[:20],
        "importCycles": sorted([sorted(component) for component in nx.strongly_connected_components(dependencies) if len(component) > 1], key=lambda group: (-len(group), group)),
        "limitations": [
            "Graphify relations do not prove runtime execution or billed reads/writes.",
            "Firebase callable names are string-based: consult aura-callables.json alongside the graph.",
            "No incoming edge is not evidence that a deployed function is unused.",
            "Import metrics include only relations resolved by Graphify; unresolved calls and dynamic imports require source review.",
        ],
    }
    write(out / "aura-structure.json", metrics)
    current["builtAt"] = metrics["generatedAt"]
    current["buildPolicy"] = "fresh-ast-v1"
    current["graphSha256"] = hashlib.sha256((out / "graph.json").read_bytes()).hexdigest()
    write(out / "aura-source-manifest.json", current)
    print(json.dumps({key: metrics[key] for key in ["sourceFiles", "nodes", "edges", "importEdges"]}))


if __name__ == "__main__":
    action, source, output = sys.argv[1:]
    root, out = Path(source).resolve(), Path(output).resolve()
    if action == "preflight":
        value = manifest(root)
        write(out / "aura-build-input.json", value)
        print(f"Scope validated: {value['fileCount']} code files at {value['commit'][:12]}")
    elif action == "report":
        report(root, out)
    elif action == "check":
        current = manifest(root)
        saved = json.loads((out / "aura-source-manifest.json").read_text(encoding="utf-8"))
        if current["sourceRoot"] != saved["sourceRoot"] or current["fingerprint"] != saved["fingerprint"]:
            raise SystemExit("Graph is stale or belongs to another checkout. Rebuild with matching --source/--name.")
        if saved.get("graphSha256") != hashlib.sha256((out / "graph.json").read_bytes()).hexdigest():
            raise SystemExit("Graph was modified outside the verified build. Rebuild it before use.")
        print(f"Graph matches {saved['fileCount']} current source files.")
    else:
        raise SystemExit(f"Unknown operation: {action}")
