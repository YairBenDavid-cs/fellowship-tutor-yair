"use client";

import { useRouter } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { CodeEditor } from "@/components/code-editor";
import { LessonChat } from "@/components/lesson-chat";
import { Sidebar } from "@/components/sidebar";
import type { Progress } from "@/lib/progress";
import type { Course, CourseSummary } from "@/lib/syllabus";
import {
  addOrReplaceFile,
  createProject,
  loadProjectFromStorage,
  removeFile,
  removeFolder,
  saveProjectToStorage,
  setActiveFile as setActivePath,
  type Project,
  updateFileContent,
} from "@/lib/virtual-fs";

type TutorShellProps = {
  availableCourses: CourseSummary[];
  course: Course;
  initialProgress: Progress;
};

function firstIncompleteLessonId(course: Course, progress: Progress): string {
  const completed = new Set(progress.completedLessonIds);
  const next = course.lessons.find((l) => !completed.has(l.id));
  return next?.id ?? course.lessons[course.lessons.length - 1]?.id ?? "";
}

export function TutorShell({
  availableCourses,
  course,
  initialProgress,
}: TutorShellProps) {
  return (
    <TutorShellInner
      key={course.id}
      availableCourses={availableCourses}
      course={course}
      initialProgress={initialProgress}
    />
  );
}

// ─── Drag-to-resize divider ───────────────────────────────────────────────────

function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative z-10 w-[5px] shrink-0 cursor-col-resize bg-[#3c3c3c] transition-colors hover:bg-[#007acc] active:bg-[#007acc]"
    >
      {/* Wider invisible hit area so it's easy to grab */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}

// ─── Shell inner ──────────────────────────────────────────────────────────────

function TutorShellInner({
  availableCourses,
  course,
  initialProgress,
}: TutorShellProps) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>(initialProgress);
  const [activeLessonId, setActiveLessonId] = useState<string>(() =>
    firstIncompleteLessonId(course, initialProgress)
  );

  // ── Panel visibility & sizes ──────────────────────────────────────────────
  const [showEditor, setShowEditor] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** Width of the editor panel in px (user can drag to resize). */
  const [editorWidth, setEditorWidth] = useState(680);

  // ── Drag-to-resize handler ────────────────────────────────────────────────
  const startResize = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = editorWidth;

      const onMove = (ev: MouseEvent) => {
        // Dragging the handle left → widen the editor; right → narrow it
        const delta = startX - ev.clientX;
        setEditorWidth(Math.max(280, Math.min(1400, startWidth + delta)));
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [editorWidth]
  );

  const activeLesson = useMemo(
    () =>
      course.lessons.find((l) => l.id === activeLessonId) ?? course.lessons[0],
    [activeLessonId, course.lessons]
  );

  // ── Project / Virtual FS state ────────────────────────────────────────────
  const [project, setProject] = useState<Project>(() => {
    const stored = loadProjectFromStorage(course.id, activeLessonId);
    return stored ?? createProject(activeLesson.starterFiles ?? []);
  });

  // Ref so lesson-chat transport always gets latest project without re-memoizing
  const projectRef = useRef(project);
  projectRef.current = project;

  const persistProject = useCallback(
    (p: Project) => {
      saveProjectToStorage(course.id, activeLessonId, p);
      setProject(p);
    },
    [course.id, activeLessonId]
  );

  // ── File operations ───────────────────────────────────────────────────────

  const handleFileChange = useCallback(
    (path: string, content: string) => {
      persistProject(updateFileContent(project, path, content));
    },
    [project, persistProject]
  );

  const handleActiveFileChange = useCallback(
    (path: string) => {
      persistProject(setActivePath(project, path));
    },
    [project, persistProject]
  );

  const handleFileCreate = useCallback(
    (path: string) => {
      if (path.endsWith("/.gitkeep") || path === ".gitkeep") {
        // Folder creation: store the placeholder but keep the current active file
        // so Monaco doesn't switch away from what the user is editing.
        const withKeep = addOrReplaceFile(project, path, "");
        persistProject({ ...withKeep, activeFilePath: project.activeFilePath });
      } else {
        persistProject(addOrReplaceFile(project, path, ""));
      }
    },
    [project, persistProject]
  );

  const handleFileDelete = useCallback(
    (path: string) => {
      persistProject(removeFile(project, path));
    },
    [project, persistProject]
  );

  const handleFolderDelete = useCallback(
    (folderPath: string) => {
      persistProject(removeFolder(project, folderPath));
    },
    [project, persistProject]
  );

  // Called when the tutor uses the create_file tool
  const handleTutorFileCreate = useCallback(
    (path: string, content: string) => {
      persistProject(addOrReplaceFile(project, path, content));
      // Auto-open the editor when the tutor creates a file
      setShowEditor(true);
    },
    [project, persistProject]
  );

  // Called when the tutor uses the update_file tool
  const handleTutorFileUpdate = useCallback(
    (path: string, content: string) => {
      persistProject(addOrReplaceFile(project, path, content));
    },
    [project, persistProject]
  );

  // ── Progress & navigation ─────────────────────────────────────────────────

  const refreshProgress = useCallback(async (): Promise<Progress> => {
    const res = await fetch(
      `/api/progress?courseId=${encodeURIComponent(course.id)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return progress;
    const next = (await res.json()) as Progress;
    setProgress(next);
    return next;
  }, [course.id, progress]);

  const handleLessonCompleted = useCallback(
    async (completedLessonId: string) => {
      const updated = await refreshProgress();
      const currentIndex = course.lessons.findIndex(
        (l) => l.id === completedLessonId
      );
      const next = course.lessons[currentIndex + 1];
      if (
        next &&
        !updated.completedLessonIds.includes(next.id) &&
        activeLessonId === completedLessonId
      ) {
        return next.id;
      }
      return null;
    },
    [activeLessonId, course.lessons, refreshProgress]
  );

  const goToLesson = useCallback(
    (lessonId: string) => {
      setActiveLessonId(lessonId);
      const lesson = course.lessons.find((l) => l.id === lessonId);
      if (!lesson) return;
      const stored = loadProjectFromStorage(course.id, lessonId);
      setProject(stored ?? createProject(lesson.starterFiles ?? []));
    },
    [course.id, course.lessons]
  );

  const handleCourseSelect = useCallback(
    (courseId: string) => {
      if (courseId === course.id) return;
      router.push(`/?courseId=${encodeURIComponent(courseId)}`);
    },
    [course.id, router]
  );

  return (
    <div className="flex h-svh overflow-hidden">
      {/* ── Left: Lesson sidebar (collapsible) ── */}
      {sidebarOpen ? (
        <Sidebar
          availableCourses={availableCourses}
          course={course}
          progress={progress}
          activeLessonId={activeLesson.id}
          onSelectCourse={handleCourseSelect}
          onSelectLesson={goToLesson}
          onClose={() => setSidebarOpen(false)}
        />
      ) : (
        /* Collapsed sidebar strip */
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-border bg-card py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeft className="size-4" />
          </button>
        </div>
      )}

      {/* ── Center: Tutor chat (always visible, takes remaining space) ── */}
      <main className="tutor-backdrop relative flex min-w-0 flex-1 flex-col border-l border-border">
        <LessonChat
          key={activeLesson.id}
          course={course}
          lesson={activeLesson}
          projectRef={projectRef}
          showEditor={showEditor}
          onToggleEditor={() => setShowEditor((s) => !s)}
          isAlreadyCompleted={progress.completedLessonIds.includes(
            activeLesson.id
          )}
          onLessonCompleted={handleLessonCompleted}
          onAdvance={goToLesson}
          onFileCreated={handleTutorFileCreate}
          onFileUpdated={handleTutorFileUpdate}
        />
      </main>

      {/* ── Drag handle + Monaco Editor (toggleable, resizable) ── */}
      {showEditor && (
        <>
          <ResizeHandle onMouseDown={startResize} />
          <CodeEditor
            project={project}
            onFileChange={handleFileChange}
            onActiveFileChange={handleActiveFileChange}
            onFileCreate={handleFileCreate}
            onFileDelete={handleFileDelete}
            onFolderDelete={handleFolderDelete}
            onClose={() => setShowEditor(false)}
            style={{ width: editorWidth }}
            className="shrink-0 border-l border-[#3c3c3c]"
          />
        </>
      )}
    </div>
  );
}
