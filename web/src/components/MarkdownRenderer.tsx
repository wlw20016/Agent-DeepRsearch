import { Suspense, lazy, type ReactNode } from "react";

type Props = {
  content: string;
  className?: string;
  fallback?: ReactNode;
};

const MarkdownContent = lazy(() => import("./MarkdownContent"));

export function MarkdownRenderer({ content, className, fallback = null }: Props) {
  return (
    <Suspense fallback={fallback}>
      <MarkdownContent content={content} className={className} />
    </Suspense>
  );
}
