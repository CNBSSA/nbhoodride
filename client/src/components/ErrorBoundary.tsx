import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// App-wide safety net. Without this, a render-time throw anywhere in the tree
// unmounts the whole React root and leaves the user staring at a blank white
// screen with no on-screen explanation ("blank booting forever"). This catches
// that case, logs the real error, and shows a recoverable screen instead.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the real error in the console for diagnosis even in production.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-md mx-auto text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <i className="fas fa-triangle-exclamation text-destructive text-2xl" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              The app hit an unexpected error. Reloading usually fixes it. If it
              keeps happening, please let us know.
            </p>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
              data-testid="button-error-reload"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
