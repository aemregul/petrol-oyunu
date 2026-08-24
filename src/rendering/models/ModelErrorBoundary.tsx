import React from 'react';

interface Props {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Keeps a missing or broken model file from taking the whole 3D scene down
 * with it. Without this, one failed .glb fetch throws out of Suspense and
 * unmounts the Canvas, so the station disappears rather than one car.
 */
export class ModelErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn('[Model] Yüklenemedi, yedek geometri kullanılıyor:', error);
  }

  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
