"use client";

import { ChevronDown, ChevronRight, FileCode, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { type FileTreeNode, buildFileTree, type Project } from "@/lib/virtual-fs";

type FileExplorerProps = {
  project: Project;
  onFileSelect: (path: string) => void;
};

export function FileExplorer({ project, onFileSelect }: FileExplorerProps) {
  const tree = buildFileTree(project.files);

  return (
    <div className="flex flex-col gap-0.5 p-2 text-sm">
      <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Project Files
      </p>
      {tree.map((node, i) => (
        <TreeNode
          key={i}
          node={node}
          depth={0}
          activeFilePath={project.activeFilePath}
          onFileSelect={onFileSelect}
        />
      ))}
      {project.files.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">No files yet.</p>
      )}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  activeFilePath,
  onFileSelect,
}: {
  node: FileTreeNode;
  depth: number;
  activeFilePath: string;
  onFileSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const indent = depth * 12;

  if (node.kind === "file") {
    const isActive = node.path === activeFilePath;
    return (
      <button
        onClick={() => onFileSelect(node.path)}
        style={{ paddingLeft: indent + 4 }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <FileCode className="size-3.5 shrink-0 text-blue-400/70" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: indent + 4 }}
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        {open ? (
          <FolderOpen className="size-3.5 shrink-0 text-yellow-400/70" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-yellow-400/70" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <div>
          {node.children.map((child, i) => (
            <TreeNode
              key={i}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
