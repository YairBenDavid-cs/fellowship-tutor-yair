"use client";

import MonacoEditor from "@monaco-editor/react";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Play,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  buildFileTree,
  detectLanguage,
  type FileTreeNode,
  type Project,
  type ProjectFile,
} from "@/lib/virtual-fs";

// ─── Types ────────────────────────────────────────────────────────────────────

type CodeEditorProps = {
  project: Project;
  onFileChange: (path: string, content: string) => void;
  onActiveFileChange: (path: string) => void;
  onFileCreate: (path: string) => void;
  onFileDelete: (path: string) => void;
  onFolderDelete: (folderPath: string) => void;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
};

type TerminalLine = {
  type: "info" | "output" | "error" | "input";
  text: string;
};

// ─── Pyodide singleton loader ─────────────────────────────────────────────────

let pyodidePromise: Promise<unknown> | null = null;

async function getPyodide(): Promise<unknown> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    // Inject script tag if not already present
    if (!(window as unknown as Record<string, unknown>).loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load Pyodide script"));
        document.head.appendChild(s);
      });
    }
    return (
      window as unknown as { loadPyodide: (opts: { indexURL: string }) => Promise<unknown> }
    ).loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",
    });
  })();
  return pyodidePromise;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CodeEditor({
  project,
  onFileChange,
  onActiveFileChange,
  onFileCreate,
  onFileDelete,
  onFolderDelete,
  onClose,
  className,
  style,
}: CodeEditorProps) {
  // Tab bar shows real files only (no .gitkeep placeholders)
  const tabFiles = project.files.filter(
    (f) => !f.path.endsWith("/.gitkeep") && f.path !== ".gitkeep"
  );
  // activeFile: prefer the real active path, fall back to first real file
  const activeFile = tabFiles.find((f) => f.path === project.activeFilePath)
    ?? tabFiles[0];
  // File tree is built from ALL files so folders (backed by .gitkeep) stay visible
  const fileTree = buildFileTree(project.files);

  // ── New-file inline creation ─────────────────────────────────────────────
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const newFileInputRef = useRef<HTMLInputElement>(null);

  // ── New-folder inline creation ───────────────────────────────────────────
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  /** Open the new-file input, optionally pre-filled with a folder prefix. */
  const startCreate = useCallback((prefix = "") => {
    setIsCreatingFolder(false);
    setIsCreating(true);
    setNewFileName(prefix);
    setTimeout(() => {
      newFileInputRef.current?.focus();
      if (prefix) {
        const len = prefix.length;
        newFileInputRef.current?.setSelectionRange(len, len);
      }
    }, 30);
  }, []);

  const startCreateFolder = useCallback(() => {
    setIsCreating(false);
    setIsCreatingFolder(true);
    setNewFolderName("");
    setTimeout(() => newFolderInputRef.current?.focus(), 30);
  }, []);

  const commitCreate = useCallback(() => {
    const name = newFileName.trim();
    if (name) onFileCreate(name);
    setIsCreating(false);
    setNewFileName("");
  }, [newFileName, onFileCreate]);

  const commitCreateFolder = useCallback(() => {
    const name = newFolderName.trim().replace(/\/$/, "");
    if (name) onFileCreate(`${name}/.gitkeep`);
    setIsCreatingFolder(false);
    setNewFolderName("");
  }, [newFolderName, onFileCreate]);

  const handleCreateKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitCreate();
      if (e.key === "Escape") {
        setIsCreating(false);
        setNewFileName("");
      }
    },
    [commitCreate]
  );

  const handleFolderKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commitCreateFolder();
      if (e.key === "Escape") {
        setIsCreatingFolder(false);
        setNewFolderName("");
      }
    },
    [commitCreateFolder]
  );

  // ── Editor change ────────────────────────────────────────────────────────
  // Use activeFile.path (what Monaco is actually showing), NOT project.activeFilePath,
  // because project.activeFilePath may point to a .gitkeep after folder creation.
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined && activeFile) {
        onFileChange(activeFile.path, value);
      }
    },
    [onFileChange, activeFile?.path] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Terminal ─────────────────────────────────────────────────────────────
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { type: "info", text: "▶  Click Run to execute the active Python file." },
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLines]);

  const pushLines = useCallback((lines: TerminalLine[]) => {
    setTerminalLines((prev) => [...prev, ...lines]);
  }, []);

  const runCode = useCallback(async () => {
    if (!activeFile || isRunning) return;
    if (activeFile.language !== "python") {
      setShowTerminal(true);
      pushLines([
        { type: "error", text: `✗  Run is only supported for Python files.` },
      ]);
      return;
    }

    setShowTerminal(true);
    setIsRunning(true);
    pushLines([{ type: "input", text: `$ python ${activeFile.path}` }]);

    try {
      pushLines([{ type: "info", text: "⏳  Loading Python runtime…" }]);
      const py = (await getPyodide()) as {
        runPythonAsync: (code: string) => Promise<unknown>;
        setStdout: (opts: { batched: (t: string) => void }) => void;
        setStderr: (opts: { batched: (t: string) => void }) => void;
      };

      const collected: TerminalLine[] = [];
      py.setStdout({
        batched: (text) => {
          for (const line of text.split("\n")) {
            if (line !== "") collected.push({ type: "output", text: line });
          }
        },
      });
      py.setStderr({
        batched: (text) => {
          for (const line of text.split("\n")) {
            if (line !== "") collected.push({ type: "error", text: line });
          }
        },
      });

      // Remove the "Loading…" line now that Pyodide is ready
      setTerminalLines((prev) =>
        prev.filter((l) => l.text !== "⏳  Loading Python runtime…")
      );

      await py.runPythonAsync(activeFile.content);

      pushLines(
        collected.length > 0
          ? collected
          : [{ type: "info", text: "(no output)" }]
      );
    } catch (e: unknown) {
      setTerminalLines((prev) =>
        prev.filter((l) => l.text !== "⏳  Loading Python runtime…")
      );
      const msg = e instanceof Error ? e.message : String(e);
      pushLines([{ type: "error", text: msg }]);
    } finally {
      setIsRunning(false);
    }
  }, [activeFile, isRunning, pushLines]);

  const clearTerminal = useCallback(() => {
    setTerminalLines([
      { type: "info", text: "▶  Click Run to execute the active Python file." },
    ]);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={style} className={cn("flex min-h-0 flex-col bg-[#1e1e1e]", className)}>
      {/* ── Two-panel body: explorer | editor+terminal ── */}
      <div className="flex min-h-0 flex-1">

        {/* ── Left: VS Code-style File Explorer ── */}
        <div className="flex w-52 shrink-0 flex-col border-r border-[#3c3c3c] bg-[#1e1e1e]">
          {/* Explorer header */}
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#3c3c3c] px-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[#bbb]">
              Explorer
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={startCreateFolder}
                title="New folder"
                className="rounded p-0.5 text-[#858585] transition-colors hover:bg-[#3c3c3c] hover:text-[#cccccc]"
              >
                <FolderPlus className="size-3.5" />
              </button>
              <button
                onClick={() => startCreate()}
                title="New file"
                className="rounded p-0.5 text-[#858585] transition-colors hover:bg-[#3c3c3c] hover:text-[#cccccc]"
              >
                <FilePlus className="size-3.5" />
              </button>
            </div>
          </div>

          {/* File tree */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {/* Inline new-folder input */}
            {isCreatingFolder && (
              <div className="flex items-center gap-1.5 px-3 py-1">
                <Folder className="size-3.5 shrink-0 text-[#dcb67a]" />
                <input
                  ref={newFolderInputRef}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.currentTarget.value)}
                  onKeyDown={handleFolderKey}
                  onBlur={commitCreateFolder}
                  placeholder="folder-name"
                  className="min-w-0 flex-1 border-b border-[#007acc] bg-transparent text-xs text-[#cccccc] outline-none placeholder:text-[#555]"
                />
              </div>
            )}

            {/* Inline new-file input */}
            {isCreating && (
              <div className="flex items-center gap-1.5 px-3 py-1">
                <FileCode className="size-3.5 shrink-0 text-[#858585]" />
                <input
                  ref={newFileInputRef}
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.currentTarget.value)}
                  onKeyDown={handleCreateKey}
                  onBlur={commitCreate}
                  placeholder="filename.py"
                  className="min-w-0 flex-1 border-b border-[#007acc] bg-transparent text-xs text-[#cccccc] outline-none placeholder:text-[#555]"
                />
              </div>
            )}

            {/* Tree */}
            {fileTree.map((node, i) => (
              <ExplorerNode
                key={i}
                node={node}
                depth={0}
                activeFilePath={activeFile?.path ?? project.activeFilePath}
                onSelect={onActiveFileChange}
                onDelete={onFileDelete}
                onDeleteFolder={onFolderDelete}
                onCreateFileIn={startCreate}
              />
            ))}

            {tabFiles.length === 0 && !isCreating && !isCreatingFolder && (
              <p className="px-3 py-2 text-[11px] text-[#555]">
                No files yet.{" "}
                <button
                  onClick={() => startCreate()}
                  className="text-[#007acc] hover:underline"
                >
                  + New File
                </button>
              </p>
            )}
          </div>
        </div>

        {/* ── Right: Editor + Terminal ── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Tab bar + Run / Terminal / close buttons */}
          <div className="flex h-9 shrink-0 items-center border-b border-[#3c3c3c] bg-[#1e1e1e]">
            <div className="flex min-w-0 flex-1 overflow-x-auto scrollbar-none">
              {tabFiles.map((file) => (
                <FileTab
                  key={file.path}
                  file={file}
                  isActive={file.path === (activeFile?.path ?? project.activeFilePath)}
                  onClick={() => onActiveFileChange(file.path)}
                />
              ))}
            </div>

            {/* ── Run button (Python files only) ── */}
            {activeFile?.language === "python" && (
              <button
                onClick={runCode}
                disabled={isRunning || !activeFile}
                title="Run Python file (Pyodide)"
                className="flex h-full shrink-0 items-center gap-1.5 border-l border-[#3c3c3c] px-3 text-xs font-medium text-[#4ec9b0] transition-colors hover:bg-[#3c3c3c] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isRunning ? (
                  <>
                    <Square className="size-3 animate-pulse" />
                    Running…
                  </>
                ) : (
                  <>
                    <Play className="size-3" />
                    Run
                  </>
                )}
              </button>
            )}

            {/* ── Terminal toggle ── */}
            <button
              onClick={() => setShowTerminal((s) => !s)}
              title="Toggle terminal"
              className={cn(
                "flex h-full shrink-0 items-center gap-1 border-l border-[#3c3c3c] px-2.5 text-xs transition-colors hover:bg-[#3c3c3c]",
                showTerminal
                  ? "bg-[#3c3c3c] text-[#cccccc]"
                  : "text-[#858585] hover:text-[#cccccc]"
              )}
            >
              <Terminal className="size-3.5" />
            </button>

            {/* ── Close editor panel ── */}
            <button
              onClick={onClose}
              title="Close editor"
              className="flex h-full shrink-0 items-center border-l border-[#3c3c3c] px-2.5 text-[#858585] transition-colors hover:bg-[#3c3c3c] hover:text-[#cccccc]"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Monaco editor (shrinks when terminal is open) */}
          <div className="min-h-0 flex-1">
            {activeFile ? (
              <MonacoEditor
                key={activeFile.path}
                height="100%"
                language={activeFile.language}
                value={activeFile.content}
                onChange={handleEditorChange}
                theme="vs-dark"
                onMount={(editor) => {
                  // Prevent Monaco from stealing keyboard focus from the chat textarea.
                  // Monaco calls editor.focus() automatically after mount; we restore
                  // focus to whatever the user was typing in before the file switch.
                  const prevFocus = document.activeElement as HTMLElement | null;
                  if (
                    prevFocus &&
                    prevFocus !== document.body &&
                    !prevFocus.closest(".monaco-editor")
                  ) {
                    requestAnimationFrame(() => prevFocus.focus());
                  }
                }}
                options={{
                  fontSize: 13,
                  fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
                  lineHeight: 20,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  tabSize: 2,
                  padding: { top: 12, bottom: 12 },
                  renderLineHighlight: "line",
                  smoothScrolling: true,
                  cursorBlinking: "smooth",
                  folding: true,
                  lineNumbers: "on",
                  glyphMargin: false,
                  lineDecorationsWidth: 0,
                  overviewRulerBorder: false,
                  scrollbar: {
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6,
                  },
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[#555]">
                <div className="text-center">
                  <FileCode className="mx-auto mb-3 size-10" />
                  <p className="text-sm">Select a file to edit</p>
                  <button
                    onClick={() => startCreate()}
                    className="mt-2 text-xs text-[#007acc] hover:underline"
                  >
                    or create a new file
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Terminal panel ── */}
          {showTerminal && (
            <div className="flex h-52 shrink-0 flex-col border-t border-[#3c3c3c]">
              {/* Terminal header */}
              <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#3c3c3c] bg-[#1e1e1e] px-3">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#bbb]">
                    Terminal
                  </span>
                  <button
                    onClick={runCode}
                    disabled={isRunning || !activeFile}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[#4ec9b0] transition-colors hover:bg-[#3c3c3c] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isRunning ? (
                      <>
                        <Square className="size-2.5 animate-pulse" />
                        Running…
                      </>
                    ) : (
                      <>
                        <Play className="size-2.5" />
                        Run
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={clearTerminal}
                    className="rounded px-1.5 py-0.5 text-[10px] text-[#858585] transition-colors hover:bg-[#3c3c3c] hover:text-[#cccccc]"
                    title="Clear output"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setShowTerminal(false)}
                    className="rounded p-0.5 text-[#858585] transition-colors hover:bg-[#3c3c3c] hover:text-[#cccccc]"
                    title="Close terminal"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>

              {/* Output */}
              <div className="min-h-0 flex-1 overflow-y-auto bg-[#1e1e1e] p-2 font-mono">
                {terminalLines.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      "text-[11px] leading-relaxed whitespace-pre-wrap",
                      line.type === "output" && "text-[#cccccc]",
                      line.type === "error" && "text-[#f44747]",
                      line.type === "info" && "text-[#569cd6]",
                      line.type === "input" && "text-[#4ec9b0]"
                    )}
                  >
                    {line.text}
                  </div>
                ))}
                <div ref={terminalEndRef} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Status bar (VS Code blue) ── */}
      <div className="flex h-5 shrink-0 items-center gap-2 bg-[#007acc] px-3 text-[10px] text-white">
        {activeFile ? (
          <>
            <span className="uppercase tracking-wide">{activeFile.language}</span>
            <span className="ml-auto truncate opacity-80">{activeFile.path}</span>
          </>
        ) : (
          <span className="opacity-60">No file open</span>
        )}
      </div>
    </div>
  );
}

// ─── Explorer tree node ────────────────────────────────────────────────────────

function ExplorerNode({
  node,
  depth,
  activeFilePath,
  onSelect,
  onDelete,
  onDeleteFolder,
  onCreateFileIn,
}: {
  node: FileTreeNode;
  depth: number;
  activeFilePath: string;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onDeleteFolder?: (folderPath: string) => void;
  onCreateFileIn?: (prefix: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const indent = depth * 12;

  if (node.kind === "file") {
    // Hide .gitkeep placeholder files — the parent folder still renders
    if (node.name === ".gitkeep") return null;

    const isActive = node.path === activeFilePath;
    const lang = detectLanguage(node.path);

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.path)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(node.path)}
        style={{ paddingLeft: indent + 8 }}
        className={cn(
          "group flex cursor-pointer items-center gap-1.5 py-0.5 pr-2 text-xs transition-colors",
          isActive
            ? "bg-[#37373d] text-[#cccccc]"
            : "text-[#cccccc] hover:bg-[#2a2d2e]"
        )}
      >
        <FileLanguageIcon language={lang} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {/* Delete button — visible on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.path);
          }}
          title={`Delete ${node.name}`}
          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#5a1d1d] hover:text-red-400"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    );
  }

  // Directory node
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "Enter" && setOpen((o) => !o)}
        style={{ paddingLeft: indent + 4 }}
        className="group flex cursor-pointer items-center gap-1 py-0.5 pr-2 text-xs text-[#cccccc] transition-colors hover:bg-[#2a2d2e]"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-[#858585]" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-[#858585]" />
        )}
        {open ? (
          <FolderOpen className="size-3.5 shrink-0 text-[#dcb67a]" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-[#dcb67a]" />
        )}
        <span className="ml-0.5 min-w-0 flex-1 truncate">{node.name}</span>
        {/* New file inside this folder — visible on hover */}
        {onCreateFileIn && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCreateFileIn(`${node.path}/`);
            }}
            title={`New file in ${node.name}`}
            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#3c3c3c] hover:text-[#cccccc]"
          >
            <FilePlus className="size-3" />
          </button>
        )}
        {/* Delete folder — visible on hover */}
        {onDeleteFolder && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteFolder(node.path);
            }}
            title={`Delete folder ${node.name}`}
            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#5a1d1d] hover:text-red-400"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
      {open &&
        node.children.map((child, i) => (
          <ExplorerNode
            key={i}
            node={child}
            depth={depth + 1}
            activeFilePath={activeFilePath}
            onSelect={onSelect}
            onDelete={onDelete}
            onDeleteFolder={onDeleteFolder}
            onCreateFileIn={onCreateFileIn}
          />
        ))}
    </div>
  );
}

// ─── File tab ─────────────────────────────────────────────────────────────────

function FileTab({
  file,
  isActive,
  onClick,
}: {
  file: ProjectFile;
  isActive: boolean;
  onClick: () => void;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-full shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs transition-colors",
        isActive
          ? "border-[#007acc] bg-[#1e1e1e] text-[#cccccc]"
          : "border-transparent bg-[#2d2d2d] text-[#858585] hover:bg-[#2a2a2a] hover:text-[#cccccc]"
      )}
    >
      <LanguageDot language={file.language} />
      <span>{fileName}</span>
    </button>
  );
}

// ─── Language icons & dots ─────────────────────────────────────────────────────

function FileLanguageIcon({ language }: { language: string }) {
  const colorMap: Record<string, string> = {
    typescript: "text-blue-400",
    javascript: "text-yellow-400",
    python: "text-green-400",
    css: "text-purple-400",
    html: "text-orange-400",
    json: "text-yellow-600",
    markdown: "text-gray-400",
  };
  const color = colorMap[language] ?? "text-gray-400";
  return <FileCode className={cn("size-3.5 shrink-0", color)} />;
}

function LanguageDot({ language }: { language: string }) {
  const colors: Record<string, string> = {
    typescript: "bg-blue-400",
    javascript: "bg-yellow-400",
    python: "bg-green-400",
    css: "bg-purple-400",
    html: "bg-orange-400",
    json: "bg-gray-400",
  };
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        colors[language] ?? "bg-gray-500"
      )}
    />
  );
}
