export type ReviewComment = {
  readonly path: string;
  readonly line: number;
  readonly body: string;
};

// GitHub rejects a whole review when one of its inline comments sits on a line
// outside the diff's hunks, so those comments are dropped before posting.
export const filterToDiff = <T extends ReviewComment>(
  diff: string,
  comments: readonly T[]
): { kept: T[]; dropped: T[] } => {
  const linesByFile = commentableLines(diff);
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const comment of comments) {
    if (linesByFile.get(comment.path)?.has(comment.line)) kept.push(comment);
    else dropped.push(comment);
  }
  return { kept, dropped };
};

// Every new-side line inside a hunk, per file: the lines GitHub accepts an
// inline review comment on.
const commentableLines = (diff: string): Map<string, Set<number>> => {
  const files = new Map<string, Set<number>>();
  let inHeader = false;
  let lines: Set<number> | undefined;
  let nextLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      lines = undefined;
      continue;
    }
    if (inHeader) {
      if (line.startsWith("+++ b/")) {
        lines = new Set();
        files.set(line.slice("+++ b/".length), lines);
      }
      if (!line.startsWith("@@")) continue;
      inHeader = false;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (lines && (line.startsWith("+") || line.startsWith(" "))) {
      lines.add(nextLine);
      nextLine++;
    }
  }

  return files;
};
