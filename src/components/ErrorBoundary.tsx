import { Component, type ReactNode } from "react";

/**
 * Catches a crash in one screen so the rest of the app, and the season's data, stay reachable.
 * `reset` changes (e.g. with the route) clear the error.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; reset?: string; onExport?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { reset?: string }) { if (prev.reset !== this.props.reset && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page narrow">
        <section className="card crash" role="alert">
          <h1>This screen hit a problem</h1>
          <p>Nothing has been deleted. The error was:</p>
          <pre className="crash-msg">{this.state.error.message}</pre>
          <div className="row gap-sm wrap">
            <button className="primary" onClick={() => location.reload()}>Reload</button>
            {this.props.onExport && <button onClick={this.props.onExport}>Export this season</button>}
            <a href="#/">Back to seasons</a>
          </div>
        </section>
      </main>
    );
  }
}
