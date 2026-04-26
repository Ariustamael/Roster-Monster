import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: "2rem", color: "var(--text-muted, #666)" }}>
            <strong>Something went wrong.</strong>
            <p>Please refresh the page. If the problem persists, check the console for details.</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
