"use client";

import {
  CheckCircle2,
  GraduationCap,
  Lock,
  PanelLeftClose,
  Sparkles,
} from "lucide-react";
import { Progress as ProgressBar } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Progress } from "@/lib/progress";
import type { Course, CourseSummary, Lesson } from "@/lib/syllabus";

type LessonStatus = "completed" | "current" | "locked" | "available";

function lessonStatus(
  course: Course,
  lesson: Lesson,
  progress: Progress,
  activeLessonId: string
): LessonStatus {
  if (progress.completedLessonIds.includes(lesson.id)) return "completed";
  if (lesson.id === activeLessonId) return "current";
  const lessonIndex = course.lessons.findIndex((l) => l.id === lesson.id);
  const activeIndex = course.lessons.findIndex((l) => l.id === activeLessonId);
  if (lessonIndex < activeIndex) return "available";
  return "locked";
}

type SidebarProps = {
  availableCourses: CourseSummary[];
  course: Course;
  progress: Progress;
  activeLessonId: string;
  onSelectCourse: (courseId: string) => void;
  onSelectLesson: (lessonId: string) => void;
  onClose: () => void;
};

export function Sidebar({
  availableCourses,
  course,
  progress,
  activeLessonId,
  onSelectCourse,
  onSelectLesson,
  onClose,
}: SidebarProps) {
  const total = course.lessons.length;
  const done = progress.completedLessonIds.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="space-y-3 border-b border-border px-4 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <GraduationCap className="size-3.5" />
            Fellowship Tutor
          </div>
          <button
            onClick={onClose}
            title="Collapse sidebar"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="size-3.5" />
          </button>
        </div>
        <div className="space-y-1">
          <label
            htmlFor="course-picker"
            className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Course
          </label>
          <Select
            value={course.id}
            onValueChange={(value) => {
              if (typeof value === "string") onSelectCourse(value);
            }}
          >
            <SelectTrigger
              id="course-picker"
              className="h-8 w-full rounded-lg bg-background/70 text-xs"
            >
              <SelectValue>{course.title}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger>
              {availableCourses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{done}/{total} lessons</span>
            <span className="font-medium text-foreground">{pct}%</span>
          </div>
          <ProgressBar value={pct} className="h-1 bg-muted [&>div]:bg-brand" />
        </div>
      </div>

      {/* Lesson list */}
      <ScrollArea className="flex-1">
        <ol className="space-y-0.5 px-2 py-3">
          {course.lessons.map((lesson, idx) => {
            const status = lessonStatus(course, lesson, progress, activeLessonId);
            const clickable = status !== "locked";

            return (
              <li key={lesson.id}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onSelectLesson(lesson.id)}
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-md p-2 text-left transition-all",
                    clickable ? "cursor-pointer hover:bg-muted" : "cursor-not-allowed opacity-50",
                    status === "current" && "bg-brand/8 ring-1 ring-brand/30 hover:bg-brand/12"
                  )}
                >
                  <StatusIcon status={status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[10px]",
                          status === "current" ? "text-brand" : "text-muted-foreground"
                        )}
                      >
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={cn(
                          "truncate text-xs font-medium leading-tight",
                          status === "current" && "text-foreground",
                          status === "completed" && "text-foreground/80",
                          status === "locked" && "text-muted-foreground"
                        )}
                      >
                        {lesson.title}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "ml-5 mt-0.5 text-[10px] font-medium uppercase tracking-wide",
                        status === "completed" ? "text-success" : "text-muted-foreground"
                      )}
                    >
                      {status === "completed"
                        ? "Mastered"
                        : `${lesson.outcomes.length} outcome${lesson.outcomes.length === 1 ? "" : "s"}`}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-border px-4 py-3">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Edit{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[9px]">
            data/prompt.md
          </code>{" "}
          to change the tutor's teaching style.
        </p>
      </div>
    </aside>
  );
}

function StatusIcon({ status }: { status: LessonStatus }) {
  if (status === "completed") {
    return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />;
  }
  if (status === "current") {
    return (
      <span className="relative mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-brand/30" />
        <Sparkles className="relative size-3.5 text-brand" />
      </span>
    );
  }
  if (status === "locked") {
    return <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />;
  }
  return (
    <span className="mt-0.5 size-3.5 shrink-0 rounded-full border border-muted-foreground/40" />
  );
}
