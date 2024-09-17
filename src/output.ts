import type { OutputLine, Stringifyable } from "./output_entry";
import { OutputEntry } from "./output_entry";
import { throttle } from "./throttle";

const runThrottled = throttle((fn: () => void) => fn(), 1000, {
  leading: true,
  trailing: true,
});

class OutputBuffer {
  private lines: OutputLine[] = [];
  private firstOpenLineIdx = 0;

  put(lines: readonly OutputLine[]) {
    let checkClosed = true;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      this.lines.push(l);
      if (checkClosed && !l.entryClosed) {
        checkClosed = false;
        this.firstOpenLineIdx = i;
      }
    }
  }

  findFirstDifferentLine(buff: OutputBuffer): number | null {
    const lim = Math.max(this.lines.length, buff.lines.length);
    for (let i = this.firstOpenLineIdx; i < lim; i++) {
      if (this.lines[i]?.content !== buff.lines[i]?.content) return i;
    }

    return null;
  }

  lineCount() {
    return this.lines.length;
  }

  slice(fromLineIdx: number): OutputLine[] {
    return this.lines.slice(fromLineIdx);
  }
}

export class Output {
  private static outEntries: OutputEntry<any>[] = [];
  private static currentBuffer = new OutputBuffer();

  private static replaceStdoutLine(lineIdx: number, replacement: string) {
    process.stdout.moveCursor(0, -lineIdx);
    process.stdout.clearLine(0);
    process.stdout.write("\r" + replacement + "\r");
    process.stdout.moveCursor(0, lineIdx);
  }

  private static isRenderQueued = false;

  /**
   * Requests a re-render of the output buffer.
   *
   * @internal
   */
  static _rerender() {
    if (this.isRenderQueued) {
      return;
    }

    this.isRenderQueued = true;
    setTimeout(() => {
      this.isRenderQueued = false;

      runThrottled(() => {
        const newBuffer = new OutputBuffer();

        for (let i = 0; i < this.outEntries.length; i++) {
          const entry = this.outEntries[i]!;
          if (!entry.isDeleted) {
            newBuffer.put(entry.getContent());
          }
        }

        // index of the line from which we need to perform the re-render
        const startIdx = this.currentBuffer.findFirstDifferentLine(newBuffer);

        if (startIdx === null) {
          return;
        }

        const linesToClear = this.currentBuffer.lineCount() - startIdx;
        const replacementLines = newBuffer.slice(startIdx);

        for (let i = linesToClear; i > 0; i--) {
          const replacement = replacementLines.shift();
          if (replacement != null) {
            this.replaceStdoutLine(i, replacement.content);
          } else {
            process.stdout.write("\u001b[T\u001b[2K");
          }
        }

        for (let i = 0; i < replacementLines.length; i++) {
          const line = replacementLines[i]!;
          process.stdout.write(line.content + "\n");
        }

        this.currentBuffer = newBuffer;
      });
    }, 25);
  }

  /**
   * When a line is written out to the stdout by the user or via other means,
   * this function can be called to inform the output about it, then
   * that content won't be overwritten by the output when performing next re-render.
   *
   * Usage of this is not recommended. Use of `Output.line` and `Output.dline` is
   * preferred.
   */
  static _outsideLineWritten(lineContent: string) {
    const lines = lineContent.split("\n");
    const entry = new OutputEntry(this, lines).setSeparator("\n").close();
    this.outEntries.push(entry);
    this.currentBuffer.put(entry.getContent());
  }

  /**
   * Max Fps determines how often the output is updated. By default the
   * Output will operate on up to 1fps (1 update per second).
   */
  static setMaxFps(fps: number) {
    runThrottled.setWait(Math.max(1, Math.floor(1000 / fps)));
  }

  /**
   * Prints a dynamic line to the stdout. Dynamic line can be changed or deleted later.
   */
  static dline(initialContent: string): OutputEntry<[string]>;
  static dline<T extends Array<Stringifyable | undefined>>(
    initialContent: T,
    separator?: string,
  ): OutputEntry<T>;
  static dline(
    initialContent: string | Array<Stringifyable | undefined>,
    separator?: string,
  ): OutputEntry<any> {
    if (typeof initialContent === "string") {
      initialContent = [initialContent];
    }

    const line = new OutputEntry(this, initialContent);
    this.outEntries.push(line);

    if (separator !== undefined) {
      line.setSeparator(separator, false);
    }

    this._rerender();

    return line;
  }

  /**
   * Prints a line to the stdout.
   */
  static line(content: string): void;
  static line(
    content: Array<Stringifyable | undefined>,
    separator?: string,
  ): void;
  static line(
    content: string | Array<Stringifyable | undefined>,
    separator?: string,
  ): void {
    if (typeof content === "string") {
      content = [content];
    }

    const line = new OutputEntry(this, content);
    this.outEntries.push(line);

    if (separator) {
      line.setSeparator(separator, false);
    }

    line.close();

    this._rerender();
  }
}
