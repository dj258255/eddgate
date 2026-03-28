import blessed from "neo-blessed";

/**
 * Blessed-native prompt components.
 * Replaces @clack/prompts for in-blessed interactions.
 */

/**
 * Show a list selection dialog inside a blessed screen.
 */
export function blessedSelect(
  screen: any,
  options: {
    message: string;
    items: Array<{ value: string; label: string; hint?: string }>;
    parent?: any;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    const box = blessed.box({
      parent: options.parent ?? screen,
      top: "center",
      left: "center",
      width: "60%",
      height: Math.min(options.items.length + 4, 20),
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      label: ` ${options.message} `,
    });

    const list = blessed.list({
      parent: box,
      top: 0,
      left: 0,
      width: "100%-2",
      height: "100%-2",
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { bg: "cyan", fg: "black", bold: true },
        item: { fg: "white" },
      },
      items: options.items.map(
        (item) => `  ${item.label}${item.hint ? `  {gray-fg}${item.hint}{/gray-fg}` : ""}`,
      ),
    });

    list.on("select", (_el: any, index: number) => {
      box.destroy();
      screen.render();
      resolve(options.items[index]?.value ?? null);
    });

    list.key(["escape"], () => {
      box.destroy();
      screen.render();
      resolve(null);
    });

    list.focus();
    screen.render();
  });
}

/**
 * Show a text input dialog inside a blessed screen.
 */
export function blessedInput(
  screen: any,
  options: {
    message: string;
    defaultValue?: string;
    parent?: any;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    const box = blessed.box({
      parent: options.parent ?? screen,
      top: "center",
      left: "center",
      width: "60%",
      height: 5,
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      label: ` ${options.message} `,
    });

    const input = blessed.textbox({
      parent: box,
      top: 0,
      left: 1,
      width: "100%-4",
      height: 1,
      inputOnFocus: true,
      style: {
        fg: "white",
        focus: { fg: "cyan" },
      },
      value: options.defaultValue ?? "",
    });

    blessed.box({
      parent: box,
      top: 2,
      left: 1,
      width: "100%-4",
      height: 1,
      tags: true,
      content: "{gray-fg}Enter: confirm  Esc: cancel{/gray-fg}",
    });

    input.on("submit", (value: string) => {
      box.destroy();
      screen.render();
      resolve(value);
    });

    input.on("cancel", () => {
      box.destroy();
      screen.render();
      resolve(null);
    });

    screen.render();
    // readInput activates the text input mode (cursor visible, typing works)
    input.readInput();
  });
}

/**
 * Show a confirm dialog inside a blessed screen.
 */
export function blessedConfirm(
  screen: any,
  options: {
    message: string;
    parent?: any;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    const box = blessed.box({
      parent: options.parent ?? screen,
      top: "center",
      left: "center",
      width: "50%",
      height: 5,
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "yellow" } },
      label: ` ${options.message} `,
    });

    const list = blessed.list({
      parent: box,
      top: 0,
      left: 2,
      width: "100%-6",
      height: 2,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { bg: "cyan", fg: "black", bold: true },
        item: { fg: "white" },
      },
      items: ["  Yes", "  No"],
    });

    list.on("select", (_el: any, index: number) => {
      box.destroy();
      screen.render();
      resolve(index === 0);
    });

    list.key(["escape"], () => {
      box.destroy();
      screen.render();
      resolve(false);
    });

    list.focus();
    screen.render();
  });
}

/**
 * Show a message box that dismisses on any key.
 */
export function blessedMessage(
  screen: any,
  content: string,
  options?: { label?: string; height?: number },
): Promise<void> {
  return new Promise((resolve) => {
    const box = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "70%",
      height: options?.height ?? "50%",
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "gray" } },
      label: options?.label ? ` ${options.label} ` : undefined,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: "cyan" } },
      keys: true,
      vi: true,
      mouse: true,
      padding: { left: 1, right: 1 },
      content,
    });

    const hint = blessed.box({
      parent: box,
      bottom: 0,
      right: 1,
      width: 20,
      height: 1,
      tags: true,
      content: "{gray-fg}q/Esc: close{/gray-fg}",
    });

    box.key(["escape", "q", "enter"], () => {
      box.destroy();
      screen.render();
      resolve();
    });

    box.focus();
    screen.render();
  });
}
