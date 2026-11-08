// Structural types for the browser supplied by the Playwright tool.
export interface BrowserLocator {
  locator(selector: string): BrowserLocator;
  contentFrame(): BrowserLocator;
  getByRole(role: string, options: { name: string; exact?: boolean }): BrowserLocator;
  click(): Promise<void>;
  press(key: string): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
  fill(value: string): Promise<void>;
  selectOption(value: string): Promise<string[]>;
  check(): Promise<void>;
  count(): Promise<number>;
  inputValue(): Promise<string>;
  filter(options: { hasText: string | RegExp }): BrowserLocator;
  waitFor(options: { state: "visible" | "hidden" }): Promise<void>;
  evaluate<T>(fn: (element: HTMLElement) => T): Promise<T>;
  evaluateAll<T>(fn: (elements: HTMLElement[]) => T): Promise<T>;
}
export interface BrowserPage extends BrowserLocator {
  emulateMedia(options: { colorScheme: "light" | "dark" | null }): Promise<void>;
  setViewportSize(options: { width: number; height: number }): Promise<void>;
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => boolean): Promise<unknown>;
  route(url: string, handler: (route: BrowserRoute) => Promise<void>): Promise<void>;
  unroute(url: string): Promise<void>;
}
export interface BrowserRoute {
  request(): { postDataJSON(): { action?: string; operation?: { id?: string } } };
  continue(): Promise<void>;
  fulfill(options: { status: number; contentType: string; body: string }): Promise<void>;
}
