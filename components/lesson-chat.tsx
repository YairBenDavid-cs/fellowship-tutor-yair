"use client";

import {
  DefaultChatTransport,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { useChat } from "@ai-sdk/react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Code2,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Course, Lesson } from "@/lib/syllabus";

import type { Project } from "@/lib/virtual-fs";

type CompleteLessonOutput = {
  ok: boolean;
  lessonId?: string;
  lessonTitle?: string;
  courseId?: string;
  reason?: string;
  error?: string;
};

type FileToolOutput = {
  ok: boolean;
  path: string;
  content: string;
  reason: string;
};

function findCompletionPart(messages: UIMessage[]): {
  output: CompleteLessonOutput;
  toolCallId: string;
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts) {
      const toolPart = part as ToolUIPart;
      if (
        toolPart.type === "tool-complete_lesson" &&
        toolPart.state === "output-available"
      ) {
        const output = toolPart.output as CompleteLessonOutput;
        if (output?.ok) {
          return { output, toolCallId: toolPart.toolCallId };
        }
      }
    }
  }
  return null;
}

type LessonChatProps = {
  course: Course;
  lesson: Lesson;
  /** Ref to the current project — used in transport body without causing re-memoization */
  projectRef: React.RefObject<Project>;
  /** Whether the Monaco editor panel is currently visible */
  showEditor: boolean;
  /** Toggle the Monaco editor panel open/closed */
  onToggleEditor: () => void;
  isAlreadyCompleted: boolean;
  onLessonCompleted: (lessonId: string) => Promise<string | null>;
  onAdvance: (lessonId: string) => void;
  onFileCreated: (path: string, content: string) => void;
  onFileUpdated: (path: string, content: string) => void;
};

export function LessonChat({
  course,
  lesson,
  projectRef,
  showEditor,
  onToggleEditor,
  isAlreadyCompleted,
  onLessonCompleted,
  onAdvance,
  onFileCreated,
  onFileUpdated,
}: LessonChatProps) {
  const [input, setInput] = useState("");
  const [nextLessonId, setNextLessonId] = useState<string | null>(null);
  const handledCompletionRef = useRef<string | null>(null);
  const handledFileToolsRef = useRef<Set<string>>(new Set());

  // ── Transport: include project files on every send ───────────────────────
  // prepareSendMessagesRequest is called right before each fetch, so it
  // reads the latest projectRef.current without needing to re-memoize.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { courseId: course.id, lessonId: lesson.id },
        prepareSendMessagesRequest: ({ body }) => ({
          body: {
            ...body,
            projectFiles: projectRef.current?.files ?? [],
            activeFilePath: projectRef.current?.activeFilePath,
          },
        }),
      }),
    [course.id, lesson.id, projectRef]
  );

  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
  });

  const completion = findCompletionPart(messages);
  const isComplete = isAlreadyCompleted || completion !== null;
  const isStreaming = status === "submitted" || status === "streaming";

  // ── Handle complete_lesson tool ──────────────────────────────────────────
  useEffect(() => {
    if (!completion) return;
    const key = completion.toolCallId;
    if (handledCompletionRef.current === key) return;
    handledCompletionRef.current = key;
    onLessonCompleted(lesson.id).then((next) => {
      setNextLessonId(next);
    });
  }, [completion, lesson.id, onLessonCompleted]);

  // ── Handle create_file and update_file tools ─────────────────────────────
  useEffect(() => {
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts) {
        const p = part as ToolUIPart;
        if (p.state !== "output-available") continue;

        if (p.type === "tool-create_file" && !handledFileToolsRef.current.has(p.toolCallId)) {
          const out = p.output as FileToolOutput;
          if (out?.ok) {
            handledFileToolsRef.current.add(p.toolCallId);
            onFileCreated(out.path, out.content);
          }
        }

        if (p.type === "tool-update_file" && !handledFileToolsRef.current.has(p.toolCallId)) {
          const out = p.output as FileToolOutput;
          if (out?.ok) {
            handledFileToolsRef.current.add(p.toolCallId);
            onFileUpdated(out.path, out.content);
          }
        }
      }
    }
  }, [messages, onFileCreated, onFileUpdated]);

  const handleSubmit = useCallback(
    (msg: PromptInputMessage) => {
      const text = msg.text.trim();
      if (!text || isStreaming || isComplete) return;
      sendMessage({ text });
      setInput("");
    },
    [isComplete, isStreaming, sendMessage]
  );

  const handleSuggestion = useCallback(
    (suggestion: string) => {
      if (isStreaming || isComplete) return;
      sendMessage({ text: suggestion });
    },
    [isComplete, isStreaming, sendMessage]
  );

  const emptyStateSuggestions = useMemo(
    () => buildSuggestions(),
    []
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <LessonHeader
        course={course}
        lesson={lesson}
        showEditor={showEditor}
        onToggleEditor={onToggleEditor}
      />

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-6 py-8">
          {messages.length === 0 ? (
            <EmptyState
              lesson={lesson}
              suggestions={emptyStateSuggestions}
              onPick={handleSuggestion}
            />
          ) : (
            messages.map((message) => (
              <MessageView key={message.id} message={message} />
            ))
          )}

          {completion && (
            <CompletionCard
              output={completion.output}
              nextLesson={
                nextLessonId
                  ? course.lessons.find((l) => l.id === nextLessonId) ?? null
                  : null
              }
              onAdvance={onAdvance}
            />
          )}

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Something went wrong. {error.message}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="relative border-t border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {isStreaming && (
          <div className="tutor-stream-bar absolute inset-x-0 top-0 h-px" />
        )}
        <div className="mx-auto w-full max-w-3xl px-6 py-4">
          {isComplete ? (
            <LockedInputNotice
              nextLesson={
                nextLessonId
                  ? course.lessons.find((l) => l.id === nextLessonId) ?? null
                  : null
              }
              onAdvance={onAdvance}
              alreadyCompletedBeforeChat={isAlreadyCompleted && !completion}
            />
          ) : (
            <PromptInput
              onSubmit={handleSubmit}
              className="rounded-2xl border border-border bg-card shadow-sm focus-within:border-brand/60 focus-within:ring-2 focus-within:ring-brand/20"
            >
              <PromptInputTextarea
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                placeholder={`Talk through "${lesson.title}" with your tutor…`}
                disabled={isComplete}
              />
              <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Press <kbd className="font-mono">Enter</kbd> to send,{" "}
                  <kbd className="font-mono">Shift+Enter</kbd> for newline
                </p>
                <PromptInputSubmit
                  status={status}
                  onStop={stop}
                  disabled={!input.trim() && !isStreaming}
                />
              </div>
            </PromptInput>
          )}
        </div>
      </div>
    </div>
  );
}

function LessonHeader({
  course,
  lesson,
  showEditor,
  onToggleEditor,
}: {
  course: Course;
  lesson: Lesson;
  showEditor: boolean;
  onToggleEditor: () => void;
}) {
  return (
    <header className="border-b border-border bg-background/60 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/40">
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <BookOpen className="size-3.5" />
            <span className="uppercase tracking-wider">{course.title}</span>
          </div>
          {/* Editor toggle button */}
          <button
            onClick={onToggleEditor}
            title={showEditor ? "Close code editor" : "Open code editor"}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
              showEditor
                ? "border-brand/40 bg-brand/10 text-brand hover:bg-brand/20"
                : "border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Code2 className="size-3" />
            {showEditor ? "Close Editor" : "Open Editor"}
          </button>
        </div>
        <h2 className="text-base font-semibold tracking-tight">{lesson.title}</h2>
        <div className="flex flex-wrap gap-1.5">
          {lesson.outcomes.map((outcome, i) => (
            <Badge
              key={i}
              variant="secondary"
              className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-normal text-muted-foreground"
            >
              {outcome}
            </Badge>
          ))}
        </div>
      </div>
    </header>
  );
}

function MessageView({ message }: { message: UIMessage }) {
  return (
    <Message from={message.role}>
      <MessageContent
        className={cn(
          message.role === "assistant" &&
            "max-w-none [&_pre]:font-mono [&_code]:font-mono"
        )}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <MessageResponse
                key={i}
                className="leading-7 [&>p]:my-2 [&_pre]:rounded-lg"
              >
                {part.text}
              </MessageResponse>
            );
          }
          if (part.type === "tool-complete_lesson") {
            const toolPart = part as ToolUIPart;
            if (toolPart.state === "output-available") {
              return null;
            }
            return (
              <div
                key={i}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Sparkles className="size-4 animate-pulse text-brand" />
                Checking the mastery outcomes…
              </div>
            );
          }
          if (part.type === "tool-create_file") {
            const toolPart = part as ToolUIPart;
            if (toolPart.state === "output-available") {
              const out = toolPart.output as { path?: string };
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                >
                  <Sparkles className="size-3.5 shrink-0 text-green-500" />
                  <span>Created <code className="font-mono text-foreground">{out.path}</code></span>
                </div>
              );
            }
            return (
              <div
                key={i}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Sparkles className="size-4 animate-pulse text-green-500" />
                Creating file…
              </div>
            );
          }
          if (part.type === "tool-update_file") {
            const toolPart = part as ToolUIPart;
            if (toolPart.state === "output-available") {
              const out = toolPart.output as { path?: string };
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                >
                  <Sparkles className="size-3.5 shrink-0 text-blue-500" />
                  <span>Updated <code className="font-mono text-foreground">{out.path}</code></span>
                </div>
              );
            }
            return (
              <div
                key={i}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Sparkles className="size-4 animate-pulse text-blue-500" />
                Updating file…
              </div>
            );
          }
          return null;
        })}
      </MessageContent>
    </Message>
  );
}

function EmptyState({
  lesson,
  suggestions,
  onPick,
}: {
  lesson: Lesson;
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <div className="relative inline-flex size-12 items-center justify-center rounded-2xl bg-brand/10">
        <Sparkles className="size-6 text-brand" />
      </div>
      <div className="max-w-md space-y-2">
        <h3 className="text-lg font-semibold tracking-tight">
          Ready when you are
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Say hi, ask a question, or jump straight in. We&apos;ll work through{" "}
          <span className="font-medium text-foreground">{lesson.title}</span>{" "}
          together at your pace.
        </p>
      </div>
      <Suggestions className="max-w-2xl justify-center pt-2">
        {suggestions.map((s) => (
          <Suggestion
            key={s}
            suggestion={s}
            onClick={onPick}
            className="border-border text-xs"
          />
        ))}
      </Suggestions>
    </div>
  );
}

function CompletionCard({
  output,
  nextLesson,
  onAdvance,
}: {
  output: CompleteLessonOutput;
  nextLesson: Lesson | null;
  onAdvance: (lessonId: string) => void;
}) {
  return (
    <div className="tutor-pop-in">
      <div className="overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/5 to-transparent">
        <div className="flex items-start gap-4 px-5 py-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 className="size-5 text-success" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
              Lesson complete
            </p>
            <h3 className="text-base font-semibold tracking-tight">
              {output.lessonTitle ?? "Mastery reached"}
            </h3>
            {output.reason && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {output.reason}
              </p>
            )}
          </div>
        </div>
        {nextLesson && (
          <div className="flex items-center justify-between gap-3 border-t border-brand/15 bg-background/40 px-5 py-3">
            <div className="min-w-0 text-sm">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Up next
              </p>
              <p className="truncate font-medium">{nextLesson.title}</p>
            </div>
            <Button
              onClick={() => onAdvance(nextLesson.id)}
              size="lg"
              className="shrink-0"
            >
              Continue
              <ArrowRight className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function LockedInputNotice({
  nextLesson,
  onAdvance,
  alreadyCompletedBeforeChat,
}: {
  nextLesson: Lesson | null;
  onAdvance: (lessonId: string) => void;
  alreadyCompletedBeforeChat: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      <p className="text-sm text-muted-foreground">
        {alreadyCompletedBeforeChat
          ? "You've already mastered this lesson. Open the next one to keep going."
          : "This lesson is complete. Ready for the next one?"}
      </p>
      {nextLesson && (
        <Button onClick={() => onAdvance(nextLesson.id)} size="sm">
          Continue
          <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}

function buildSuggestions(): string[] {
  const seeds = [
    "I'm new to this — where should we start?",
    "Quiz me on what I should know already.",
    "Show me a quick example to anchor the idea.",
  ];
  return seeds.slice(0, 3);
}
